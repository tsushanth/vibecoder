// A build (new app, retry, tweak, fork) that the API refuses writes no project row and no build_failed event, so none of the
// build monitors could see it: for ten days every build of some accounts was refused behind a generic "HTTP 500" email.
// watchBuild() sits in front of the build routes: any 4xx or 5xx answer becomes one build_refused usage event and one report
// that says what failed. A route names the cause with refuse(res, reason, code); otherwise the status decides.
// Reasons are a closed list and nothing from the request (prompt, ids) is ever sent to the reporter.
import { reportFailure } from './failureReporter.js';
import { appEvents } from './appEventsInstance.js';
import { channelFromRequest } from './appEvents.js';
import { REFUSAL_REASONS } from './refusalReasons.js';

export { REFUSAL_REASONS };

const BY_STATUS = { 400: 'invalid_request', 401: 'auth_required', 403: 'forbidden', 404: 'not_found', 429: 'limit', 504: 'worker_timeout' };
export const reasonForStatus = (status) => BY_STATUS[status] || (status >= 500 ? 'server_error' : 'invalid_request');

/** Names the cause of the refusal a route is about to send. `code` is a short machine code (database code, error name). */
export function refuse(res, reason, code) {
    if (res?.locals) res.locals.refusal = { reason, code };
}

/** Why an insert into projects failed: the missing users row is its own cause. */
export function insertRefusal(error) {
    const noRow = error?.code === '23503' && /creator_id/.test(`${error.message || ''} ${error.details || ''}`);
    return noRow ? 'no_account_row' : 'save_failed';
}

/** One report for a refusal or failure, in plain words. Also used for refusals sent on an open stream (no error status). */
export function reportRefusal(kind, reason, { status, code, report = reportFailure } = {}) {
    const why = REFUSAL_REASONS[reason] || reason;
    report('build_refused', new Error(`BUILD_REFUSED ${kind} ${reason}: ${why}`), {
        path: kind, ...(status && { http_status: String(status) }), ...(code && { error_name: String(code).slice(0, 40) }),
    });
}

/** @param {'new'|'retry'|'tweak'|'fork'} kind */
export function watchBuild(kind, { emit = appEvents.emit, report = reportFailure } = {}) {
    return (req, res, next) => {
        res.locals.failureReported = true; // reported here with its cause; the generic 5xx catch-all stays quiet
        res.on('finish', () => {
            try {
                if (res.statusCode < 400) return;
                const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
                if (!userId && res.statusCode < 500) return; // every client sends its user id: this is a probe, not a person
                const { reason = reasonForStatus(res.statusCode), code } = res.locals.refusal || {};
                emit('build_refused', { userId, props: { reason, build_kind: kind, status: res.statusCode, source: channelFromRequest(req) } });
                reportRefusal(kind, reason, { status: res.statusCode, code, report });
            } catch { /* reporting must never affect a response */ }
        });
        next();
    };
}
