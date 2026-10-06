// The scheduler tick. runDueJobs claims due jobs in one short transaction (FOR UPDATE SKIP LOCKED, so two proxy instances never
// run the same job), writes a lease and a 'running' run row, commits, and only then runs the actions, so no lock or connection
// is held while a job talks to the network. A crashed instance's jobs come back when the lease runs out.
import { nextRunAt, backoffMs, dayStartMs } from './schedule.js';

export const DEFAULTS = { limit: 10, concurrency: 3, timeoutMs: 30_000, maxRunsPerAppPerDay: 300, maxFailures: 5 };
const DAY = 86_400_000;
const at = (ms) => new Date(ms);

/** A counting semaphore. One shared gate across ticks is the process-wide concurrency cap. */
export function createGate(max) {
    let active = 0; const waiting = [];
    return {
        get active() { return active; },
        async run(fn) {
            if (active >= max) await new Promise((r) => waiting.push(r));
            else active += 1;
            try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else active -= 1; }
        },
    };
}

export async function runDueJobs({ now = Date.now, pool, limit = DEFAULTS.limit, runAction, gate, concurrency = DEFAULTS.concurrency, timeoutMs = DEFAULTS.timeoutMs, maxRunsPerAppPerDay = DEFAULTS.maxRunsPerAppPerDay, maxFailures = DEFAULTS.maxFailures, limitsFor, onRun }) {
    const clock = typeof now === 'function' ? () => Number(now()) : () => Number(now instanceof Date ? now.getTime() : now);
    const theGate = gate || createGate(concurrency);
    const lease = timeoutMs * 2 + 60_000;
    const summary = { claimed: 0, ok: 0, failed: 0, skipped: 0, disabled: 0, capped: 0 };

    const claimed = await claim();
    summary.claimed = claimed.length;
    await Promise.all(claimed.map((c) => theGate.run(() => execute(c))));
    return summary;

    async function claim() {
        const t0 = clock();
        const client = await pool.connect();
        const out = [];
        try {
            await client.query('begin');
            await client.query("update platform.job_runs set status = 'error', error_code = 'abandoned', finished_at = $1 where status = 'running' and started_at <= $2", [at(t0), at(t0 - lease)]);
            const { rows } = await client.query(
                `select j.app_id, j.job_id, j.spec, j.failures from platform.jobs j join platform.apps a on a.app_id = j.app_id
                 where j.enabled and a.enabled and j.next_run_at <= $1 order by j.next_run_at, j.app_id, j.job_id limit $2 for update of j skip locked`, [at(t0), limit]);
            for (const j of rows) {
                await client.query('select pg_advisory_xact_lock(hashtext($1))', [`jobs:${j.app_id}`]);
                const used = (await client.query("select count(*)::int n from platform.job_runs where app_id = $1 and started_at >= $2 and status <> 'skipped'", [j.app_id, at(dayStartMs(t0))])).rows[0].n;
                let cap = maxRunsPerAppPerDay;
                if (limitsFor) { const o = await limitsFor(j.app_id).catch(() => null); if (Number.isInteger(o?.jobRunsPerDay)) cap = o.jobRunsPerDay; }
                if (used >= cap) {
                    await client.query("insert into platform.job_runs (app_id, job_id, started_at, finished_at, status, error_code) values ($1, $2, $3, $3, 'skipped', 'daily_cap')", [j.app_id, j.job_id, at(t0)]);
                    await client.query("update platform.jobs set next_run_at = $3, last_status = 'daily_cap' where app_id = $1 and job_id = $2", [j.app_id, j.job_id, at(dayStartMs(t0) + DAY)]);
                    summary.capped += 1;
                    continue;
                }
                const run = (await client.query("insert into platform.job_runs (app_id, job_id, started_at, status) values ($1, $2, $3, 'running') returning id", [j.app_id, j.job_id, at(t0)])).rows[0].id;
                await client.query('update platform.jobs set next_run_at = $3 where app_id = $1 and job_id = $2', [j.app_id, j.job_id, at(t0 + lease)]);
                out.push({ appId: j.app_id, jobId: j.job_id, spec: j.spec, failures: j.failures, runId: run, startedAt: t0 });
            }
            await client.query('commit');
            return out;
        } catch (e) {
            await client.query('rollback').catch(() => {});
            throw e;
        } finally { client.release(); }
    }

    async function execute(c) {
        const wallStart = Date.now(); // real elapsed time for metering; `clock` may be a test clock
        const ctrl = new AbortController();
        let timer;
        let res;
        try {
            res = await Promise.race([
                Promise.resolve(runAction({ appId: c.appId, jobId: c.jobId, action: c.spec.action, signal: ctrl.signal })),
                new Promise((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve({ ok: false, code: 'timeout' }); }, timeoutMs); }),
            ]);
        } catch { res = { ok: false, code: 'internal_error' }; } finally { clearTimeout(timer); }
        if (!res || typeof res !== 'object') res = { ok: false, code: 'internal_error' };
        const code = typeof res.code === 'string' && /^[a-z0-9_]{1,40}$/.test(res.code) ? res.code : 'unknown_error';
        const end = clock();
        const natural = nextRunAt(c.spec.schedule, end);
        let status; let failures = c.failures; let enabled = true; let next = natural; let lastStatus;
        if (res.ok) { status = 'ok'; failures = 0; lastStatus = 'ok'; summary.ok += 1; }
        else if (res.skipped) { status = 'skipped'; lastStatus = 'skipped'; summary.skipped += 1; }
        else {
            status = 'error'; failures += 1; lastStatus = code; summary.failed += 1;
            if (failures >= maxFailures) { enabled = false; lastStatus = 'auto_disabled'; summary.disabled += 1; }
            else next = Math.min(natural, end + backoffMs(failures));
        }
        if (onRun) { try { await onRun({ appId: c.appId, ok: !!res.ok, skipped: !!res.skipped, ms: Date.now() - wallStart }); } catch { /* metering must never break a run */ } }
        const client = await pool.connect();
        try {
            await client.query('begin');
            await client.query('update platform.job_runs set status = $2, error_code = $3, finished_at = $4 where id = $1', [c.runId, status, status === 'ok' ? null : code, at(end)]);
            // spec = $: if the creator replaced this job while it ran, leave the new definition and its schedule alone
            await client.query('update platform.jobs set last_run_at = $3, last_status = $4, failures = $5, enabled = $6, next_run_at = $7 where app_id = $1 and job_id = $2 and spec = $8::jsonb', [c.appId, c.jobId, at(c.startedAt), lastStatus, failures, enabled, at(next), JSON.stringify(c.spec)]);
            await client.query('commit');
        } catch { await client.query('rollback').catch(() => {}); } finally { client.release(); }
    }
}
