/**
 * Failure-rate signal: when more than 40% of the AI builds that finished in the last 6 hours failed (and there were at
 * least 5), send ONE reportFailure('build_failure_rate', ...) and then stay quiet for 6 hours (in-process throttle, so a
 * restart can re-alert once). Counts only: no ids, prompts or users.
 *
 * Only builds created by the AI generator count (creation_method = 'ai_generated'); the projects table is shared with other
 * apps' rows. Builds still 'building' are not counted either way.
 */
import { reportFailure } from './failureReporter.js';

const HOUR = 3600_000;

export function createFailureRateMonitor({
    supabase,
    report = reportFailure,
    now = Date.now,
    windowMs = 6 * HOUR,
    throttleMs = 6 * HOUR,
    minBuilds = 5,
    threshold = 0.4,
} = {}) {
    let lastAlertAt = null;

    async function count(since, statuses) {
        const q = supabase.from('projects').select('id', { count: 'exact', head: true })
            .eq('creation_method', 'ai_generated').gte('created_at', since).in('status', statuses);
        const { count: n, error } = await q;
        if (error || typeof n !== 'number') throw new Error('count failed');
        return n;
    }

    /** Never throws. Returns { total, failed, rate, alerted } or null when the numbers could not be read. */
    async function check() {
        try {
            const since = new Date(now() - windowMs).toISOString();
            const [total, failed] = await Promise.all([count(since, ['ready', 'failed']), count(since, ['failed'])]);
            const rate = total ? failed / total : 0;
            let alerted = false;
            const throttled = lastAlertAt !== null && now() - lastAlertAt < throttleMs;
            if (total >= minBuilds && rate > threshold && !throttled) {
                lastAlertAt = now();
                alerted = true;
                report('build_failure_rate', new Error('BUILD_FAILURE_RATE_HIGH'), {
                    failed: String(failed), total: String(total), rate_pct: String(Math.round(rate * 100)), window_hours: String(windowMs / HOUR),
                });
            }
            return { total, failed, rate, alerted };
        } catch (e) {
            console.warn(`[build-failure-rate] check skipped: ${e?.message || 'error'}`);
            return null;
        }
    }

    return { check };
}

/** Runs check() on an interval. unref'd so it never keeps the process alive. */
export function startFailureRateSweep(monitor, intervalMs = 30 * 60_000) {
    const t = setInterval(() => { void monitor.check(); }, intervalMs);
    t.unref?.();
    return t;
}
