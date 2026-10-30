/**
 * Sends backend failures to the unified app-failure-reporter Worker (dedupes and emails).
 * Fire-and-forget: never throws, never blocks a request. Set FAILURE_REPORTER_DISABLED=1 to silence (tests/dev).
 * Never pass user content (transcripts, note text, emails) as message or context.
 */
const ENDPOINT = process.env.FAILURE_REPORTER_URL || 'https://app-failure-reporter.t-sushanth.workers.dev/v1/report';
const KEY = process.env.FAILURE_REPORTER_KEY || 'afr_271ab956be760e9f9b82ef912577ed22';
const APP_VERSION = process.env.FLY_IMAGE_REF || process.env.K_REVISION || process.env.npm_package_version || 'unknown';
const DISABLED = process.env.FAILURE_REPORTER_DISABLED === '1' || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';

let sink = null;
/** Tests only: capture reports instead of sending (also bypasses the silent-in-tests switch). */
export function _setSink(fn) { sink = fn; }

async function post(kind, flow, err, context, timeoutMs) {
  if (sink) { const e = err instanceof Error ? err : new Error(String(err)); sink({ kind, flow, message: e.message, context }); return; }
  if (DISABLED) return;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Report-Key': KEY },
      body: JSON.stringify({ kind, platform: 'backend', version: APP_VERSION, flow, message: e.message || e.name, stack: e.stack ?? '', context }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { /* reporting must never cause a failure of its own */ }
}

/** Route pattern when express matched one ("/api/projects/:id/deploy"), so ids never reach the flow or split the dedupe. */
export function routeOf(req) {
  return req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : (req.path ?? '');
}

/** A handled server error (5xx). Path only: never log query strings, they can carry tokens. */
export function reportBackendError(req, err, statusCode) {
  if (statusCode < 500) return;
  void post('backend_error', `${req.method} ${routeOf(req)}`, err, { status: String(statusCode) }, 5000);
}

/** A 5xx that a route returned itself (no thrown error): stable message per status, flow = method + route pattern. */
export function reportRouteError(method, route, statusCode) {
  if (statusCode < 500) return;
  void post('backend_error', `${method} ${route}`, new Error(`HTTP ${statusCode}`), { status: String(statusCode) }, 5000);
}

/** Daily counters for the reporter dashboard (idempotent per day+metric). items: [{metric, value, day?}]. Never throws. */
export async function reportUsage(items) {
  if (DISABLED || !items?.length) return;
  try {
    await fetch(ENDPOINT.replace(/\/v1\/report$/, '/v1/usage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Report-Key': KEY },
      body: JSON.stringify(items),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* best effort */ }
}

/** A background job or flow failed (worker, queue, cron). */
export function reportFailure(flow, err, context = {}) {
  void post('failure', flow, err, context, 5000);
}

/** Process is about to die: await this before process.exit so the email actually goes out. */
export function reportCrash(flow, err) {
  return post('crash', flow, err, {}, 2500);
}
