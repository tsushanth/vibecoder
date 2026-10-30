/**
 * Decisions for the one automatic, delayed re-dispatch of a build that the worker reported as failed.
 *
 * Why: of 42 users who had an AI build fail in the last 150 days, only 10 ever got a ready build afterwards and 26 never did
 * (see the funnel notes in the PR). A retry is one tap away today, but most users never make it, and failures cluster in time
 * (worker outages), so an immediate manual retry usually fails again. One server-side retry a minute later gives the same
 * project a second chance before the user is told it failed.
 *
 * Off unless BUILD_AUTO_RETRY=1 (each retry is one more worker run). At most one automatic retry per build: only the original
 * /generate callback carries ?ar=1, the automatic re-dispatch does not, and manual /retry never does.
 */
import { FAIL_CLASS } from './buildFailure.js';

export const AUTO_RETRY_FLAG = 'ar';
const RETRYABLE = new Set([FAIL_CLASS.WORKER_ERROR, FAIL_CLASS.NO_RESULT]);
const DEFAULT_DELAY_MS = 60_000;
const MAX_DELAY_MS = 5 * 60_000; // the stuck-build cron fails anything still 'building' 20 min after creation

export function autoRetryEnabled(env = process.env) {
    return env.BUILD_AUTO_RETRY === '1';
}

export function autoRetryDelayMs(env = process.env) {
    const n = Number.parseInt(env.BUILD_AUTO_RETRY_DELAY_MS ?? '', 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_DELAY_MS;
    return Math.min(n, MAX_DELAY_MS);
}

/** @param {{cls:string, flag:unknown, projectStatus:string|undefined, hasPrompt:boolean}} a */
export function shouldAutoRetry({ cls, flag, projectStatus, hasPrompt }, env = process.env) {
    return autoRetryEnabled(env)
        && String(flag) === '1'
        && RETRYABLE.has(cls)
        && projectStatus === 'building'
        && hasPrompt === true;
}

/** Marker stored in projects.error_reason while the retry is pending; stays after success so recoveries can be counted. */
export function autoRetryMarker(cls) {
    return `AUTO_RETRIED:${cls}`;
}
