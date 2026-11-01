/**
 * Sends failures to the unified app-failure-reporter Worker (dedupes per fingerprint per hour, emails the owner).
 * Fire-and-forget: never throws, never blocks. Silent when NODE_ENV is test/development or FAILURE_REPORTER_DISABLED=1.
 * Callers prefix the flow with the service name (worker:, deploy:, build-monitor:, sms-bot:).
 * Never pass user content (prompts, code, emails, user ids) as message or context: stable messages per failure class only.
 * Keep this file identical in worker/lib, deploy-server, build-monitor and sms-bot (each deploys on its own); a test enforces it.
 */
const ENDPOINT = process.env.FAILURE_REPORTER_URL || 'https://app-failure-reporter.t-sushanth.workers.dev/v1/report';
const KEY = process.env.FAILURE_REPORTER_KEY || 'afr_271ab956be760e9f9b82ef912577ed22'; // VibeBuild backend key (an identifier, not a secret)
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
      body: JSON.stringify({ kind, platform: 'backend', version: process.env.FLY_IMAGE_REF || 'unknown', flow, message: e.message || e.name, stack: e.stack ?? '', context }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { /* reporting must never cause a failure of its own */ }
}

/** A background job or flow failed. */
export function reportFailure(flow, err, context = {}) {
  void post('failure', flow, err, context, 5000);
}

/** Process is about to die: await this before process.exit so the email actually goes out. */
export function reportCrash(flow, err) {
  return post('crash', flow, err, {}, 2500);
}

/** Report then exit(1), exactly like Node's default for an uncaught exception / unhandled rejection. */
export function installCrashHandlers() {
  for (const evt of ['uncaughtException', 'unhandledRejection']) {
    process.on(evt, (err) => {
      console.error(evt, err);
      reportCrash(evt, err).finally(() => process.exit(1));
    });
  }
}

/**
 * Debounces a repeating check (e.g. a sync every 60 s) so a blip is not an email: reports once when it has failed `threshold`
 * times in a row, then stays quiet until it has succeeded again. Returns { ok(), fail(report) }.
 */
export function createStreakGate(threshold, onTrip) {
  let streak = 0;
  let tripped = false;
  return {
    ok() { streak = 0; tripped = false; },
    fail(...args) {
      streak += 1;
      if (streak >= threshold && !tripped) { tripped = true; onTrip(...args); }
    },
    get streak() { return streak; },
  };
}
