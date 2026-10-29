/**
 * One place that marks a build failed, so every failed write is visible and diagnosable.
 *
 *  1. Reports reportFailure('build_failed', <stable class>) with non-content context only. The class is the message, so the
 *     reporter's per-fingerprint hourly dedupe gives one email per reason class per hour, with a suppressed count.
 *  2. Writes status 'failed' (the original behaviour).
 *  3. Best effort: stores the reason class (plus a short sanitized message) in projects.error_reason. That column comes from
 *     a migration that may not be applied yet; any error from this second write is swallowed, so a missing column can never
 *     break a status write.
 *
 * Never pass prompts, generated code, emails or user ids into any argument other than `message`, and `message` is
 * sanitized (and goes to the database only, never to the reporter).
 */
import { reportFailure } from './failureReporter.js';

export const FAIL_CLASS = Object.freeze({
    DISPATCH_ERROR: 'DISPATCH_ERROR',     // the build worker would not take the job (HTTP error, unreachable, quota)
    WORKER_ERROR: 'WORKER_ERROR',         // the worker accepted the job and then reported an error
    NO_RESULT: 'NO_RESULT',               // the build ended without a result and without an error
    PLAN_LLM: 'PLAN_LLM',                 // the plan call to the LLM failed (reported by the plan route; it does not fail a project)
    TIMEOUT_STUCK: 'TIMEOUT_STUCK',       // still 'building' after the cleanup cutoff
    RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',   // a user retry could not be dispatched
    UNKNOWN: 'UNKNOWN',
});

/** Swappable in tests. */
export const _deps = { report: reportFailure };

const CONTEXT_KEYS = ['phase', 'httpStatus', 'attempt', 'planTier', 'path', 'errorName', 'count'];
const SAFE_VALUE = /^[A-Za-z0-9_.:\- ]{1,40}$/;
const SNAKE = { httpStatus: 'http_status', planTier: 'plan_tier', errorName: 'error_name' };
const MAX_REASON = 200;

/** Whitelist of keys, each value a short plain token. Anything else (free text, ids, emails) is dropped, not truncated. */
export function safeContext(ctx = {}) {
    const out = {};
    for (const k of CONTEXT_KEYS) {
        const v = ctx[k];
        if (v === undefined || v === null) continue;
        const s = String(v);
        if (SAFE_VALUE.test(s)) out[SNAKE[k] || k] = s;
    }
    return out;
}

/** Short, content-free version of a worker/error message for storage. Quotes, urls, emails, ids and long tokens are masked. */
export function sanitizeReason(raw) {
    if (typeof raw !== 'string') return '';
    return raw
        .replace(/\s+/g, ' ')
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
        .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '[text]')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
        .replace(/[A-Za-z0-9_\-]{24,}/g, '[token]')
        .trim()
        .slice(0, 120);
}

let columnWarned = false;
/** Best effort and never throws. Logs once per process for a missing column, once per distinct code otherwise. */
async function writeReason(supabase, ids, reason) {
    try {
        const q = supabase.from('projects').update({ error_reason: reason });
        const { error } = await (Array.isArray(ids) ? q.in('id', ids) : q.eq('id', ids));
        if (error) {
            const missing = error.code === '42703' || error.code === 'PGRST204' || /error_reason/.test(String(error.message || ''));
            if (missing) {
                if (!columnWarned) { columnWarned = true; console.warn('[build-failure] projects.error_reason is not available (migration not applied?); reasons are not being stored'); }
            } else {
                console.warn(`[build-failure] could not store reason code=${error.code || 'none'}`);
            }
        }
    } catch (e) {
        if (!columnWarned) { columnWarned = true; console.warn(`[build-failure] could not store reason: ${e?.name || 'error'}`); }
    }
}

/**
 * Marks one project (id) or several (array of ids) failed. Reports once per call. A failure of the status write itself
 * propagates exactly as it did before (callers that were fire-and-forget add .catch); report and reason never throw.
 * @param {object} supabase
 * @param {string|string[]} ids
 * @param {keyof typeof FAIL_CLASS} cls
 * @param {{phase?:string,httpStatus?:number|string,attempt?:number,planTier?:string,path?:string,errorName?:string,count?:number,message?:string}} [info]
 */
export async function markProjectFailed(supabase, ids, cls, info = {}) {
    const klass = FAIL_CLASS[cls] || FAIL_CLASS.UNKNOWN;
    try {
        // Created here so the stack's top frame is always this line: a stable fingerprint per class.
        _deps.report('build_failed', new Error(klass), safeContext(info));
    } catch { /* reporting must never break a status write */ }

    const q = supabase.from('projects').update({ status: 'failed' });
    const { error } = await (Array.isArray(ids) ? q.in('id', ids) : q.eq('id', ids));
    if (error) return; // nothing was written; do not claim a reason for a project that is not marked failed

    const detail = sanitizeReason(info.message);
    const reason = (detail ? `${klass}: ${detail}` : klass).slice(0, MAX_REASON);
    await writeReason(supabase, ids, reason);
}

/** Test hook: lets a test see the once-per-process warning again. */
export function _resetWarnings() { columnWarned = false; }
