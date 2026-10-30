/**
 * Catch-all for 5xx responses that no one reported. Dozens of handlers do `catch (e) { console.error(...); res.status(500)... }`
 * without ever reaching the error handler, so a failing route was invisible. This middleware watches the response instead:
 * any 5xx that was not already reported (res.locals.failureReported) becomes ONE backend_error with flow "<METHOD> <route pattern>"
 * and message "HTTP <status>". Route pattern (not the URL) so ids never reach the reporter and the hourly dedupe works.
 * Fire-and-forget; reportRouteError is silent in tests.
 */
import { reportRouteError } from '../lib/failureReporter.js';

// Probed by the reporter's own health checks (a 503 there is the signal, not an extra email) and the public maintenance poll.
const SKIP = new Set(['/api/health', '/api/health/deep', '/api/status']);

export function serverErrorReport({ report = reportRouteError } = {}) {
    return (req, res, next) => {
        res.on('finish', () => {
            try {
                if (res.statusCode < 500 || res.locals?.failureReported) return;
                if (SKIP.has(req.path)) return;
                const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : '(unmatched)';
                res.locals.failureReported = true;
                report(req.method, route, res.statusCode);
            } catch { /* reporting must never affect a response */ }
        });
        next();
    };
}
