// Channel-level usage events (table channel_events): one row per bot interaction, so conversion can finally be measured.
//
// Same rules as lib/appEvents.js: the event name and every prop key are allow-listed, free text (messages, names, prompts) can
// never be stored, emit() never throws and never waits, and a missing table (migration not applied) backs off quietly.
// chat_ref is a keyed hash of the channel's own id, so distinct chats can be counted without keeping the raw id here.
import { createHmac } from 'node:crypto';
import { promptLengthBucket } from '../appEvents.js';

export const CHANNELS = Object.freeze(['telegram', 'sms', 'whatsapp']);
export const CHANNEL_EVENTS = Object.freeze([
    'update_received', 'start', 'build_queued', 'build_finished', 'build_failed', 'build_stopped', 'link_started', 'link_done', 'link_failed',
    'language_changed', 'idea_picked', 'apps_listed', 'rate_limited', 'help', 'unsupported_message',
    // The person blocked / unblocked the bot (Telegram my_chat_member update; needs it in the webhook's allowed_updates), and a
    // handler error (props.error_code = HANDLER). Chat-level health, not message content.
    'bot_blocked', 'bot_unblocked', 'bot_error',
]);
const EVENT_SET = new Set(CHANNEL_EVENTS);

export const START_PAYLOADS = Object.freeze(['app', 'app_card', 'app_build', 'app_settings', 'web', 'web_home', 'web_connect', 'link', 'none', 'other']);
export const COMMANDS = Object.freeze(['start', 'apps', 'language', 'link', 'stop', 'help', 'text', 'callback', 'unknown']);
export const CAPS = Object.freeze(['chat_flood', 'anon_daily', 'anon_global_daily', 'hourly_chat', 'active_build', 'global_active', 'server_429']);
export const ERROR_CODES = Object.freeze(['DISPATCH', 'REJECTED', 'BUSY', 'LIMIT', 'WORKER', 'TIMEOUT', 'HANDLER', 'UNKNOWN']);

const oneOf = (list) => { const s = new Set(list); return (v) => (typeof v === 'string' && s.has(v) ? v : undefined); };
const PROP_VALIDATORS = Object.freeze({
    command: oneOf(COMMANDS),
    start_payload: oneOf(START_PAYLOADS),
    cap: oneOf(CAPS),
    error_code: oneOf(ERROR_CODES),
    duration_ms: (v) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 86_400_000) : undefined),
    prompt_length_bucket: (v) => (typeof v === 'string' && /^(lt40|40_99|100_249|250_799|800plus)$/.test(v) ? v : undefined),
    linked: (v) => (typeof v === 'boolean' ? v : undefined),
    from_language: (v) => (typeof v === 'string' && /^(?:[a-z]{2}|zh-(?:TW|HK))$/.test(v) ? v : undefined),
    new_chat: (v) => (typeof v === 'boolean' ? v : undefined),
    idea_index: (v) => (Number.isInteger(v) && v >= 0 && v < 10 ? v : undefined),
});
export function cleanProps(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const k of Object.keys(PROP_VALIDATORS)) { if (k in raw) { const v = PROP_VALIDATORS[k](raw[k]); if (v !== undefined) out[k] = v; } }
    return out;
}

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /channel_events.*(does not exist|schema cache)|could not find the table/i.test(String(e.message || '')));

export function chatRef(channel, rawId, salt) {
    if (rawId === undefined || rawId === null || rawId === '') return null;
    return createHmac('sha256', String(salt || 'vibebuild-channel')).update(`${channel}:${rawId}`).digest('hex').slice(0, 16);
}

/** The row to insert, or null when the event/channel is not allow-listed. */
export function buildRow({ channel = 'telegram', event, language, chatRef: ref, userId, projectId, props }) {
    if (!CHANNELS.includes(channel) || !EVENT_SET.has(event)) return null;
    return {
        channel, event,
        language: typeof language === 'string' && /^(?:[a-z]{2}|zh-(?:TW|HK))$/.test(language) ? language : null,
        chat_ref: typeof ref === 'string' && /^[0-9a-f]{16}$/.test(ref) ? ref : null,
        user_id: typeof userId === 'string' && ID.test(userId) ? userId : null,
        project_id: typeof projectId === 'string' && UUID.test(projectId) ? projectId : null,
        props: cleanProps(props),
    };
}

export function createChannelEvents({ getClient, salt = () => process.env.TELEGRAM_EVENTS_SALT || process.env.TELEGRAM_WEBHOOK_SECRET || '', enabled = () => process.env.CHANNEL_EVENTS_ENABLED !== 'false', timeoutMs = 2000, maxInFlight = 50, backoffMs = 60_000, log = console } = {}) {
    let inFlight = 0; let backoffUntil = 0; let warnedMissing = false; let warnedError = false;

    async function record(event, opts = {}) {
        let timer;
        try {
            const channel = opts.channel || 'telegram';
            const row = buildRow({ ...opts, channel, event, chatRef: chatRef(channel, opts.chatId, salt()) });
            if (!row) return { ok: false, reason: 'invalid' };
            if (!enabled()) return { ok: false, reason: 'disabled' };
            if (Date.now() < backoffUntil) return { ok: false, reason: 'backoff' };
            const client = getClient();
            if (!client) return { ok: false, reason: 'disabled' };
            const ctl = new AbortController();
            timer = setTimeout(() => ctl.abort(), timeoutMs); timer.unref?.();
            let q = client.from('channel_events').insert(row);
            if (typeof q?.abortSignal === 'function') q = q.abortSignal(ctl.signal);
            const timedOut = new Promise((resolve) => ctl.signal.addEventListener('abort', () => resolve({ error: { code: 'TIMEOUT' } })));
            const { error } = (await Promise.race([Promise.resolve(q), timedOut])) || {};
            if (!error) return { ok: true };
            if (MISSING(error)) {
                backoffUntil = Date.now() + backoffMs;
                if (!warnedMissing) { warnedMissing = true; log.warn('[channel-events] channel_events table is not available (migration not applied?); events are skipped'); }
                return { ok: false, reason: 'error' };
            }
            if (!warnedError) { warnedError = true; log.warn(`[channel-events] insert failed code=${error.code || 'none'}`); }
            return { ok: false, reason: error.code === 'TIMEOUT' ? 'timeout' : 'error' };
        } catch { return { ok: false, reason: 'error' }; } finally { if (timer) clearTimeout(timer); }
    }

    /** Fire and forget. Never throws, never waits for the database. */
    function emit(event, opts) {
        try {
            if (inFlight >= maxInFlight || !EVENT_SET.has(event) || !enabled()) return;
            inFlight++;
            record(event, opts).catch(() => {}).finally(() => { inFlight--; });
        } catch { /* an event must never break the request that produced it */ }
    }

    /** Account deletion: the person's events go with the account. Best effort. */
    async function deleteForUser(userId) {
        try {
            if (typeof userId !== 'string' || !ID.test(userId) || !enabled()) return false;
            const client = getClient(); if (!client) return false;
            const { error } = await client.from('channel_events').delete().eq('user_id', userId);
            if (error && !MISSING(error)) log.warn(`[channel-events] could not delete a user's events code=${error.code || 'none'}`);
            return !error || !!MISSING(error);
        } catch { return false; }
    }

    return { emit, record, deleteForUser, promptLengthBucket, _resetForTests: () => { backoffUntil = 0; warnedMissing = false; warnedError = false; } };
}
