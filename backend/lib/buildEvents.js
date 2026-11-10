// Glue between the build/tweak routes and lib/appEvents.js: remembers when each build started so build_ready / build_failed can
// carry a duration, decides plan_step_skipped, throttles `login`, and looks up the owner of a project when a callback has only an id.
// Pure in-memory bookkeeping (bounded, TTL) plus fire-and-forget emits; nothing here can throw into a route.
import { promptLengthBucket } from './appEvents.js';

const START_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 5000;
const PLAN_WINDOW_MS = 30 * 60 * 1000;
const LOGIN_WINDOW_MS = 30 * 60 * 1000;

function prune(map, ttlMs, now) {
    if (map.size < MAX_ENTRIES) return;
    for (const [k, v] of map) { if (now - (v.at ?? v) > ttlMs) map.delete(k); }
    // still full (a burst of fresh entries): drop the oldest so memory stays bounded
    while (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value);
}

/**
 * @param {{ emit: Function, getClient?: () => any, now?: () => number }} deps
 */
export function createBuildEvents({ emit, getClient = () => null, now = Date.now }) {
    const starts = new Map();   // projectId -> { at, userId, kind }
    const plans = new Map();    // userId -> time of the last /plan call
    const logins = new Map();   // userId -> time of the last login event

    /** Records that a build started and emits build_started. `prompt` is used only for its length. */
    function buildStarted({ projectId, userId, source, prompt, kind = 'new' }) {
        try {
            const t = now();
            if (projectId) { prune(starts, START_TTL_MS, t); starts.set(projectId, { at: t, userId: userId || null, kind, source }); }
            emit('build_started', { userId, props: {
                source, build_kind: kind,
                prompt_length_bucket: promptLengthBucket(typeof prompt === 'string' ? prompt.length : NaN),
                plan_step_skipped: kind === 'new' ? planSkipped(userId, t) : undefined,
            } });
        } catch { /* never break a build */ }
    }
    const planSkipped = (userId, t) => !(userId && plans.has(userId) && t - plans.get(userId) < PLAN_WINDOW_MS);

    /** Called by POST /plan: the person saw the plan step (even if they then built something else). */
    function planRequested(userId) {
        try {
            if (typeof userId !== 'string' || !userId) return;
            const t = now();
            if (plans.size >= MAX_ENTRIES) { for (const [k, v] of plans) { if (t - v > PLAN_WINDOW_MS) plans.delete(k); } while (plans.size >= MAX_ENTRIES) plans.delete(plans.keys().next().value); }
            plans.set(userId, t);
        } catch { /* ignore */ }
    }

    async function owners(projectIds) {
        // For ids with no in-memory start (restart, cron sweep): the owner and creation time from the row. Best effort.
        const out = new Map();
        try {
            const client = getClient();
            if (!client || !projectIds.length) return out;
            const { data } = await client.from('projects').select('id, creator_id, created_at').in('id', projectIds);
            for (const r of Array.isArray(data) ? data : []) if (r?.id) out.set(r.id, { userId: r.creator_id || null, at: Date.parse(r.created_at) });
        } catch { /* ignore */ }
        return out;
    }

    async function outcome(event, projectIds, { source, code, status, userId } = {}) {
        try {
            const ids = (Array.isArray(projectIds) ? projectIds : [projectIds]).filter(Boolean);
            const t = now();
            const known = new Map();
            const missing = [];
            for (const id of ids) {
                const s = starts.get(id);
                if (s) { known.set(id, s); starts.delete(id); } else missing.push(id);
            }
            const looked = missing.length ? await owners(missing) : new Map();
            for (const id of ids) {
                const s = known.get(id) || looked.get(id) || {};
                const who = s.userId || userId || null;
                emit(event, { userId: who, props: {
                    duration_ms: Number.isFinite(s.at) ? t - s.at : undefined,
                    build_kind: s.kind,
                    source: s.source || source,
                    error_code: code,
                    status: Number.isInteger(status) ? status : undefined,
                } });
            }
        } catch { /* ignore */ }
    }

    const buildReady = (projectId, opts) => outcome('build_ready', projectId, opts);
    const buildFailed = (projectIds, opts) => outcome('build_failed', projectIds, opts);

    /** login: at most one per person per half hour (the web app registers on every page load). True when it should be emitted. */
    function loginDue(userId) {
        try {
            if (typeof userId !== 'string' || !userId) return false;
            const t = now();
            const last = logins.get(userId);
            if (last !== undefined && t - last < LOGIN_WINDOW_MS) return false;
            if (logins.size >= MAX_ENTRIES) { for (const [k, v] of logins) { if (t - v > LOGIN_WINDOW_MS) logins.delete(k); } while (logins.size >= MAX_ENTRIES) logins.delete(logins.keys().next().value); }
            logins.set(userId, t);
            return true;
        } catch { return false; }
    }

    return { buildStarted, planRequested, buildReady, buildFailed, loginDue, _sizes: () => ({ starts: starts.size, plans: plans.size, logins: logins.size }) };
}
