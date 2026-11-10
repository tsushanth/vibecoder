// First-party usage events (table app_events). Answers "where do people drop off and why" without any third-party SDK.
//
// Rules this module enforces in code, not by convention:
//   - the event name must be on EVENTS;
//   - props are copied key by key through a validator per key (a closed enum, a bounded number or a boolean), so a prompt, an
//     email, an error message or any other free text cannot be stored even if a caller passes it by mistake;
//   - user_id must look like an id (letters, digits, `_ . : -`), so an email address is refused;
//   - emit() never throws and never makes the caller wait: it validates, hands the insert to the background with a timeout,
//     drops the event when too many inserts are already pending, and backs off when the table is missing (migration not applied).

export const EVENTS = Object.freeze([
    'signup_completed',
    'login',
    'build_started',
    'build_ready',
    'build_failed',
    'tweak_started',
    'tweak_ready',
    'tweak_failed',
    'publish',
    'unpublish',
    'rate_limited',
    'paywall_or_cap_shown',
    'project_deleted',
    'account_deleted',
    'first_build_survey',
]);
const EVENT_SET = new Set(EVENTS);

export const SOURCES = Object.freeze(['web', 'android', 'ios', 'api']);
export const PROMPT_LENGTH_BUCKETS = Object.freeze(['lt40', '40_99', '100_249', '250_799', '800plus']);
export const BUILD_KINDS = Object.freeze(['new', 'retry']);
// Which limit was hit (rate_limited) or which plan gate was shown (paywall_or_cap_shown).
export const CAPS = Object.freeze([
    'hourly_generation', 'daily_generations', 'tweaks_per_project', 'plan_hourly', 'worker_busy', 'worker_quota',
    'tweak_tier', 'private_tier', 'fork_tier',
]);
export const SURVEY_CHOICES = Object.freeze(['game_or_fun', 'personal_tool', 'work_or_business', 'learning', 'just_trying', 'something_else', 'dismissed']);
// Short machine codes only: the build-failure classes (lib/buildFailure.js FAIL_CLASS) plus a few transport outcomes.
export const ERROR_CODES = Object.freeze([
    'DISPATCH_ERROR', 'WORKER_ERROR', 'NO_RESULT', 'PLAN_LLM', 'TIMEOUT_STUCK', 'RETRY_EXHAUSTED', 'UNKNOWN',
    'TIMEOUT', 'WORKER_HTTP', 'SAVE_FAILED',
]);

const oneOf = (list) => { const s = new Set(list); return (v) => (typeof v === 'string' && s.has(v) ? v : undefined); };
const intIn = (lo, hi) => (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    const n = Math.round(v);
    return n >= lo && n <= hi ? n : undefined;
};
const bool = (v) => (typeof v === 'boolean' ? v : undefined);

const DAY_MS = 24 * 60 * 60 * 1000;
// One validator per allowed prop key. A key that is not here is dropped; a value that fails its validator is dropped.
const PROP_VALIDATORS = Object.freeze({
    duration_ms: (v) => { const n = intIn(0, Number.MAX_SAFE_INTEGER)(v); return n === undefined ? undefined : Math.min(n, DAY_MS); }, // clamped: a stuck build is "at least a day", not a bad row
    status: intIn(100, 599),
    error_code: oneOf(ERROR_CODES),
    source: oneOf(SOURCES),
    plan_step_skipped: bool,
    prompt_length_bucket: oneOf(PROMPT_LENGTH_BUCKETS),
    build_kind: oneOf(BUILD_KINDS),
    cap: oneOf(CAPS),
    choice: oneOf(SURVEY_CHOICES),
});
export const PROP_KEYS = Object.freeze(Object.keys(PROP_VALIDATORS));

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const cleanId = (v) => (typeof v === 'string' && ID.test(v) ? v : null);

/** The size bucket for a prompt's length. Only the bucket is ever stored. */
export function promptLengthBucket(length) {
    if (!Number.isFinite(length) || length < 0) return undefined;
    if (length < 40) return 'lt40';
    if (length < 100) return '40_99';
    if (length < 250) return '100_249';
    if (length < 800) return '250_799';
    return '800plus';
}

/** Which client made the request: web, android, ios or api (anything else). */
export function sourceFromRequest(req) {
    const header = String(req?.headers?.['x-client-platform'] ?? '').trim().toLowerCase();
    if (header === 'web' || header === 'android' || header === 'ios') return header;
    const ua = String(req?.headers?.['user-agent'] ?? '');
    if (/okhttp|dalvik/i.test(ua)) return 'android';
    if (/cfnetwork|darwin/i.test(ua)) return 'ios';
    if (/^mozilla\//i.test(ua)) return 'web';
    return 'api';
}

/** Copies only allow-listed keys whose values pass their validator. Never throws. */
export function cleanProps(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const key of PROP_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
        const v = PROP_VALIDATORS[key](raw[key]);
        if (v !== undefined) out[key] = v;
    }
    return out;
}

/** The row to insert, or null when the event is not allow-listed. user_id/anon_id that do not look like ids become null. */
export function buildRow({ event, userId, anonId, props }) {
    if (typeof event !== 'string' || !EVENT_SET.has(event)) return null;
    return { user_id: cleanId(userId), anon_id: cleanId(anonId), event, props: cleanProps(props) };
}

const MISSING_TABLE = (error) => error && (error.code === '42P01' || error.code === 'PGRST205' || /app_events.*(does not exist|schema cache)|could not find the table/i.test(String(error.message || '')));

/**
 * @param {{ getClient: () => any, timeoutMs?: number, maxInFlight?: number, backoffMs?: number, enabled?: () => boolean, log?: Console }} deps
 */
export function createAppEvents({ getClient, timeoutMs = 2000, maxInFlight = 50, backoffMs = 60_000, enabled = () => true, log = console } = {}) {
    let inFlight = 0;
    let backoffUntil = 0;
    let warnedMissing = false;
    let warnedError = false;

    /**
     * Awaitable version, used where the outcome matters (the first-build survey). Never throws.
     * @returns {Promise<{ok: boolean, reason?: 'invalid'|'disabled'|'backoff'|'duplicate'|'timeout'|'error'}>}
     */
    async function record(event, { userId, anonId, props } = {}) {
        let timer;
        try {
            const row = buildRow({ event, userId, anonId, props });
            if (!row) return { ok: false, reason: 'invalid' };
            if (!enabled()) return { ok: false, reason: 'disabled' };
            if (Date.now() < backoffUntil) return { ok: false, reason: 'backoff' };
            const client = getClient();
            if (!client) return { ok: false, reason: 'disabled' };

            const ctl = new AbortController();
            timer = setTimeout(() => ctl.abort(), timeoutMs);
            timer.unref?.();
            let q = client.from('app_events').insert(row);
            if (typeof q?.abortSignal === 'function') q = q.abortSignal(ctl.signal);
            const timedOut = new Promise((resolve) => ctl.signal.addEventListener('abort', () => resolve({ error: { code: 'TIMEOUT' } })));
            const { error } = (await Promise.race([Promise.resolve(q), timedOut])) || {};
            if (!error) return { ok: true };
            if (error.code === 'TIMEOUT') return { ok: false, reason: 'timeout' };
            if (error.code === '23505') return { ok: false, reason: 'duplicate' };
            if (MISSING_TABLE(error)) {
                backoffUntil = Date.now() + backoffMs;
                if (!warnedMissing) { warnedMissing = true; log.warn('[app-events] app_events table is not available (migration not applied?); events are skipped'); }
                return { ok: false, reason: 'error' };
            }
            if (!warnedError) { warnedError = true; log.warn(`[app-events] insert failed code=${error.code || 'none'}`); }
            return { ok: false, reason: 'error' };
        } catch (e) {
            if (!warnedError) { warnedError = true; log.warn(`[app-events] insert failed: ${e?.name || 'error'}`); }
            return { ok: false, reason: 'error' };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** Fire and forget: returns immediately, never throws, never waits for the database. */
    function emit(event, opts) {
        try {
            if (inFlight >= maxInFlight) return;
            if (!EVENT_SET.has(event) || !enabled()) return;
            inFlight++;
            record(event, opts).catch(() => {}).finally(() => { inFlight--; });
        } catch { /* an event must never break the request that produced it */ }
    }

    /** Deletes every event of one user (account deletion). Best effort and never throws; true when the delete ran without error. */
    async function deleteForUser(userId) {
        try {
            const id = cleanId(userId);
            const client = getClient();
            if (!id || !client || !enabled()) return false;
            const { error } = await client.from('app_events').delete().eq('user_id', id);
            if (error && !MISSING_TABLE(error)) log.warn(`[app-events] could not delete a user's events code=${error.code || 'none'}`);
            return !error || !!MISSING_TABLE(error);
        } catch { return false; }
    }

    return { emit, record, deleteForUser, _state: () => ({ inFlight, backoffUntil }), _resetForTests: () => { backoffUntil = 0; warnedMissing = false; warnedError = false; } };
}
