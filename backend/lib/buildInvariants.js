/**
 * End-to-end invariants that do not depend on any single failure path (or on an external cron firing):
 *
 *  - BUILDS_STUCK: AI builds still 'building' well past the cleanup cutoff (the cleanup route cuts at 20 min). If any exist,
 *    the external cleanup cron and the build-monitor are both not doing their job. One alert per 2 h per process.
 *  - BUILDS_NONE_READY: >= 3 AI builds were created in the last 24 h and none is 'ready'. Nobody is getting an app.
 *    One alert per 6 h per process.
 *  - Daily counters pushed to the reporter dashboard (api.projects_created / ready / failed) so created-vs-ready per day is visible.
 *
 * Counts only: no ids, prompts or users. Never throws. In-process throttles mean a restart can re-alert once; the reporter
 * dedupes per fingerprint per hour on top of that.
 */
import { reportFailure, reportUsage } from './failureReporter.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

export function createBuildInvariantMonitor({
    supabase,
    report = reportFailure,
    usage = reportUsage,
    now = Date.now,
    stuckAfterMs = 30 * MIN,
    stuckThrottleMs = 2 * HOUR,
    noneReadyThrottleMs = 6 * HOUR,
    minAttempts = 3,
} = {}) {
    const last = { stuck: null, none: null };

    async function count(build) {
        const { count: n, error } = await build(supabase.from('projects').select('id', { count: 'exact', head: true }).eq('creation_method', 'ai_generated'));
        if (error || typeof n !== 'number') throw new Error('count failed');
        return n;
    }
    const throttled = (key, ms) => last[key] !== null && now() - last[key] < ms;

    /** Never throws. Returns the numbers it read, or null when they could not be read. */
    async function check() {
        try {
            const day = new Date(now()).toISOString().slice(0, 10);
            const dayStart = `${day}T00:00:00.000Z`;
            const since24 = new Date(now() - 24 * HOUR).toISOString();
            const stuckBefore = new Date(now() - stuckAfterMs).toISOString();
            const [stuck, attempts24, ready24, created, ready, failed] = await Promise.all([
                count((q) => q.eq('status', 'building').lt('created_at', stuckBefore)),
                count((q) => q.gte('created_at', since24)),
                count((q) => q.gte('created_at', since24).eq('status', 'ready')),
                count((q) => q.gte('created_at', dayStart)),
                count((q) => q.gte('created_at', dayStart).eq('status', 'ready')),
                count((q) => q.gte('created_at', dayStart).eq('status', 'failed')),
            ]);
            const out = { stuck, attempts24, ready24, alerts: [] };
            if (stuck > 0 && !throttled('stuck', stuckThrottleMs)) {
                last.stuck = now(); out.alerts.push('BUILDS_STUCK');
                report('build_invariant', new Error('BUILDS_STUCK'), { count: String(stuck), older_than_min: String(stuckAfterMs / MIN) });
            }
            if (attempts24 >= minAttempts && ready24 === 0 && !throttled('none', noneReadyThrottleMs)) {
                last.none = now(); out.alerts.push('BUILDS_NONE_READY');
                report('build_invariant', new Error('BUILDS_NONE_READY'), { attempts_24h: String(attempts24), ready_24h: '0' });
            }
            try { void usage([{ metric: 'api.projects_created', value: created, day }, { metric: 'api.projects_ready', value: ready, day }, { metric: 'api.projects_failed', value: failed, day }]); } catch { /* best effort */ }
            return out;
        } catch (e) {
            console.warn(`[build-invariants] check skipped: ${e?.message || 'error'}`);
            return null;
        }
    }
    return { check };
}

/** Runs check() on an interval. unref'd so it never keeps the process alive. */
export function startInvariantSweep(monitor, intervalMs = 10 * MIN) {
    const t = setInterval(() => { void monitor.check(); }, intervalMs);
    t.unref?.();
    return t;
}
