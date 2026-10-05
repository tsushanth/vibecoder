import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createJobsStore } from '../store.js';
import { runDueJobs, createGate, DEFAULTS } from '../runner.js';

const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
const MIN = 60_000; const HOUR = 3_600_000; const DAY = 86_400_000;
const PRUNE = { type: 'prune', table: 'readings', olderThanDays: 30 };
const job = (id, schedule = { every: '1h' }) => ({ id, schedule, action: PRUNE });

let db, skip, stores, store, seq = 0;
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    stores = createPgStores({ pool: db.pool, masterKey: masterKey() });
    store = createJobsStore({ pool: db.pool, now: () => T0 });
});
after(async () => { if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await db.pool.query('delete from platform.job_runs; delete from platform.jobs'); await f(c); });
// every test gets its own apps so state never leaks between them
const app = async (enabled = true) => { const id = `rj-${++seq}`; await stores.upsertApp({ appId: id, enabled }); return id; };
const row = async (appId, jobId) => (await db.pool.query('select * from platform.jobs where app_id = $1 and job_id = $2', [appId, jobId])).rows[0];
const runs = async (appId, jobId) => (await db.pool.query('select * from platform.job_runs where app_id = $1 and ($2::text is null or job_id = $2) order by id', [appId, jobId ?? null])).rows;
const ms = (d) => d && d.getTime();
const tick = (now, runAction, extra = {}) => runDueJobs({ now: () => now, pool: db.pool, runAction, ...extra });
const okAction = async () => ({ ok: true });
const failAction = (code = 'upstream_500') => async () => ({ ok: false, code });
const sleep = (n) => new Promise((r) => setTimeout(r, n));

t('only due jobs run; the clock decides, and the next run is one interval after the finish', async () => {
    const a = await app(); await store.setJobs(a, [job('j1')]);
    assert.equal(ms((await row(a, 'j1')).next_run_at), T0 + HOUR, 'first run is one interval after the job was declared');
    const calls = [];
    const act = async (x) => { calls.push(x); return { ok: true }; };
    assert.equal((await tick(T0 + HOUR - 1, act)).claimed, 0);
    assert.equal(calls.length, 0);
    const s = await tick(T0 + HOUR, act);
    assert.deepEqual(s, { claimed: 1, ok: 1, failed: 0, skipped: 0, disabled: 0, capped: 0 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].appId, a); assert.equal(calls[0].jobId, 'j1'); assert.deepEqual(calls[0].action, PRUNE); assert.ok(calls[0].signal instanceof AbortSignal);
    const r = await row(a, 'j1');
    assert.equal(ms(r.last_run_at), T0 + HOUR); assert.equal(r.last_status, 'ok'); assert.equal(r.failures, 0); assert.equal(r.enabled, true);
    assert.equal(ms(r.next_run_at), T0 + 2 * HOUR);
    assert.equal((await tick(T0 + HOUR + 30 * MIN, act)).claimed, 0, 'not due again until the next interval');
    const rr = await runs(a);
    assert.equal(rr.length, 1); assert.equal(rr[0].status, 'ok'); assert.equal(rr[0].error_code, null); assert.equal(ms(rr[0].started_at), T0 + HOUR); assert.equal(ms(rr[0].finished_at), T0 + HOUR);
});

t('dailyAt jobs run at that time of day', async () => {
    const a = await app(); await store.setJobs(a, [job('d', { dailyAt: '09:30', tz: 'UTC' })]);
    assert.equal(ms((await row(a, 'd')).next_run_at), Date.UTC(2026, 10, 15, 9, 30));
    assert.equal((await tick(Date.UTC(2026, 10, 15, 9, 29), okAction)).claimed, 0);
    assert.equal((await tick(Date.UTC(2026, 10, 15, 9, 30, 5), okAction)).ok, 1);
    assert.equal(ms((await row(a, 'd')).next_run_at), Date.UTC(2026, 10, 16, 9, 30));
});

t('the limit bounds how many jobs one tick claims, oldest due first', async () => {
    const a = await app(); await store.setJobs(a, [job('a1', { every: '15m' }), job('a2', { every: '1h' }), job('a3', { every: '6h' })]);
    const seen = [];
    const act = async (x) => { seen.push(x.jobId); return { ok: true }; };
    assert.equal((await tick(T0 + 7 * HOUR, act, { limit: 2 })).claimed, 2);
    assert.deepEqual(seen.sort(), ['a1', 'a2']);
    assert.equal((await tick(T0 + 7 * HOUR, act, { limit: 2 })).claimed, 1);
    assert.deepEqual(seen.sort(), ['a1', 'a2', 'a3']);
    assert.equal(DEFAULTS.limit, 10);
});

t('two concurrent ticks never run the same job twice (FOR UPDATE SKIP LOCKED)', async () => {
    const apps = []; for (let i = 0; i < 3; i++) { const a = await app(); apps.push(a); await store.setJobs(a, [job('x1'), job('x2')]); }
    const counts = new Map();
    const act = async ({ appId, jobId }) => { const k = `${appId}/${jobId}`; counts.set(k, (counts.get(k) || 0) + 1); await sleep(80); return { ok: true }; };
    const summaries = await Promise.all([1, 2, 3, 4].map(() => tick(T0 + 2 * HOUR, act)));
    assert.equal(counts.size, 6);
    for (const [k, n] of counts) assert.equal(n, 1, `${k} ran ${n} times`);
    assert.equal(summaries.reduce((n, s) => n + s.claimed, 0), 6);
    for (const a of apps) assert.equal((await runs(a)).length, 2);
});

t('concurrent ticks with a small limit split the work instead of overlapping', async () => {
    const apps = []; for (let i = 0; i < 4; i++) { const a = await app(); apps.push(a); await store.setJobs(a, [job('s')]); }
    const counts = new Map();
    const act = async ({ appId }) => { counts.set(appId, (counts.get(appId) || 0) + 1); await sleep(60); return { ok: true }; };
    const [s1, s2] = await Promise.all([tick(T0 + 2 * HOUR, act, { limit: 2 }), tick(T0 + 2 * HOUR, act, { limit: 2 })]);
    assert.equal(s1.claimed + s2.claimed, 4);
    assert.deepEqual([...counts.values()], [1, 1, 1, 1]);
});

t('a job claimed by a tick that died comes back after the lease, and its run row is closed as abandoned', async () => {
    const a = await app(); await store.setJobs(a, [job('c')]);
    let release; const hang = new Promise((r) => { release = r; });
    const first = tick(T0 + HOUR, async () => { await hang; return { ok: true }; }, { timeoutMs: 600_000 });
    await sleep(150);
    assert.equal((await row(a, 'c')).failures, 0);
    const leaseEnd = T0 + HOUR + 600_000 * 2 + 60_000;
    assert.equal((await tick(T0 + HOUR + 5 * MIN, okAction, { timeoutMs: 600_000 })).claimed, 0, 'leased: another instance leaves it alone');
    assert.equal(ms((await row(a, 'c')).next_run_at), leaseEnd);
    assert.equal((await tick(leaseEnd - 1, okAction, { timeoutMs: 600_000 })).claimed, 0);
    assert.equal((await tick(leaseEnd, okAction, { timeoutMs: 600_000 })).claimed, 1, 'lease over: picked up again');
    const rr = await runs(a, 'c');
    assert.equal(rr[0].status, 'error'); assert.equal(rr[0].error_code, 'abandoned'); assert.equal(rr[1].status, 'ok');
    release(); await first;
});

t('failures back off exponentially, never later than the natural schedule, and the 5th consecutive failure disables the job', async () => {
    const a = await app(); await store.setJobs(a, [job('f', { every: '6h' })]);
    let now = T0 + 6 * HOUR;
    const want = [5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN];
    for (let i = 0; i < 4; i++) {
        assert.equal((await tick(now, failAction())).failed, 1);
        const r = await row(a, 'f');
        assert.equal(r.failures, i + 1); assert.equal(r.enabled, true); assert.equal(r.last_status, 'upstream_500');
        assert.equal(ms(r.next_run_at), now + want[i], `retry ${i + 1}`);
        assert.equal((await tick(now + want[i] - 1, failAction())).claimed, 0, 'not before the back-off ends');
        now += want[i];
    }
    const s = await tick(now, failAction('db_busy'));
    assert.deepEqual(s, { claimed: 1, ok: 0, failed: 1, skipped: 0, disabled: 1, capped: 0 });
    const r = await row(a, 'f');
    assert.equal(r.failures, 5); assert.equal(r.enabled, false); assert.equal(r.last_status, 'auto_disabled');
    assert.equal((await tick(now + 30 * DAY, failAction())).claimed, 0, 'a disabled job never runs');
    const rr = await runs(a, 'f');
    assert.equal(rr.length, 5); assert.ok(rr.every((x) => x.status === 'error'));
    assert.deepEqual(rr.map((x) => x.error_code), ['upstream_500', 'upstream_500', 'upstream_500', 'upstream_500', 'db_busy']);
});

t('back-off never pushes a job past its natural schedule', async () => {
    const a = await app(); await store.setJobs(a, [job('n', { every: '15m' })]);
    let now = T0 + 15 * MIN;
    await tick(now, failAction()); assert.equal(ms((await row(a, 'n')).next_run_at), now + 5 * MIN);
    now += 5 * MIN; await tick(now, failAction()); assert.equal(ms((await row(a, 'n')).next_run_at), now + 10 * MIN);
    now += 10 * MIN; await tick(now, failAction()); assert.equal(ms((await row(a, 'n')).next_run_at), now + 15 * MIN, '20 minute back-off is capped at the 15 minute interval');
});

t('a success resets the failure count; 4 failures then a success never disables', async () => {
    const a = await app(); await store.setJobs(a, [job('r', { every: '15m' })]);
    let now = T0 + HOUR;
    for (let i = 0; i < 4; i++) { await tick(now, failAction()); now += 15 * MIN; }
    assert.equal((await row(a, 'r')).failures, 4);
    await tick(now, okAction);
    let r = await row(a, 'r'); assert.equal(r.failures, 0); assert.equal(r.enabled, true); assert.equal(r.last_status, 'ok');
    now += 15 * MIN;
    for (let i = 0; i < 4; i++) { await tick(now, failAction()); now += 15 * MIN; }
    r = await row(a, 'r'); assert.equal(r.failures, 4); assert.equal(r.enabled, true);
});

t('a skipped run is not a failure and does not consume the daily cap', async () => {
    const a = await app(); await store.setJobs(a, [job('k', { every: '15m' })]);
    let now = T0 + HOUR;
    for (let i = 0; i < 4; i++) { const s = await tick(now, async () => ({ ok: false, skipped: true, code: 'rate_limited_app' }), { maxRunsPerAppPerDay: 2 }); assert.equal(s.skipped, 1); now += 15 * MIN; }
    const r = await row(a, 'k');
    assert.equal(r.failures, 0); assert.equal(r.enabled, true); assert.equal(r.last_status, 'skipped'); assert.equal(ms(r.next_run_at), now);
    assert.deepEqual((await runs(a, 'k')).map((x) => [x.status, x.error_code]), Array(4).fill(['skipped', 'rate_limited_app']));
    assert.equal((await tick(now, okAction, { maxRunsPerAppPerDay: 2 })).ok, 1, 'skips did not use up the cap');
});

t('the per-app daily cap defers the job to the next UTC day and records why; other apps are unaffected', async () => {
    const a = await app(); const b = await app();
    await store.setJobs(a, [job('c1', { every: '15m' })]); await store.setJobs(b, [job('c1', { every: '15m' })]);
    const day = Date.UTC(2026, 10, 16);
    let now = day + 15 * MIN; let ran = 0;
    const act = async () => { ran++; return { ok: true }; };
    for (let i = 0; i < 3; i++) { await tick(now, act, { maxRunsPerAppPerDay: 3 }); now += 15 * MIN; }
    assert.equal(ran, 6, 'both apps ran 3 times');
    const s = await tick(now, act, { maxRunsPerAppPerDay: 3 });
    assert.deepEqual([s.claimed, s.capped, s.ok], [0, 2, 0], 'capped jobs are not claimed for running');
    assert.equal(ran, 6);
    const r = await row(a, 'c1');
    assert.equal(ms(r.next_run_at), day + DAY); assert.equal(r.last_status, 'daily_cap'); assert.equal(r.failures, 0); assert.equal(r.enabled, true);
    const rr = await runs(a, 'c1');
    assert.equal(rr.at(-1).status, 'skipped'); assert.equal(rr.at(-1).error_code, 'daily_cap');
    assert.equal((await tick(day + DAY - 1, act, { maxRunsPerAppPerDay: 3 })).claimed, 0);
    assert.equal((await tick(day + DAY + 1, act, { maxRunsPerAppPerDay: 3 })).ok, 2, 'new day, new allowance');
    assert.equal(DEFAULTS.maxRunsPerAppPerDay, 300);
});

t('the daily cap holds even when ticks race: the same app never exceeds it', async () => {
    const a = await app(); await store.setJobs(a, [job('p1'), job('p2'), job('p3'), job('p4'), job('p5')]);
    let ran = 0;
    const act = async () => { ran++; await sleep(40); return { ok: true }; };
    const ss = await Promise.all([1, 2, 3].map(() => tick(T0 + 2 * HOUR, act, { maxRunsPerAppPerDay: 2, limit: 2 })));
    assert.equal(ran, 2);
    const todays = (await runs(a)).filter((r) => r.status !== 'skipped');
    assert.equal(todays.length, 2);
    assert.ok(ss.reduce((n, s) => n + s.capped, 0) >= 1);
});

t('disabled apps are not claimed, job-level disabled is respected, and re-enabling the app resumes the job', async () => {
    const a = await app(false); await store.setJobs(a, [job('o')]);
    assert.equal((await tick(T0 + 3 * HOUR, okAction)).claimed, 0);
    assert.equal((await runs(a)).length, 0);
    await stores.setEnabled(a, true);
    assert.equal((await tick(T0 + 3 * HOUR, okAction)).ok, 1);
    const b = await app(); await store.setJobs(b, [job('o')]);
    await db.pool.query("update platform.jobs set enabled = false where app_id = $1", [b]);
    await tick(T0 + 9 * HOUR, okAction);
    assert.equal((await runs(b)).length, 0, 'a job switched off is never claimed');
});

t('a hanging action is cut off at the timeout: error code timeout, signal aborted', async () => {
    const a = await app(); await store.setJobs(a, [job('h')]);
    let sig;
    const s = await tick(T0 + HOUR, async ({ signal }) => { sig = signal; await new Promise(() => {}); }, { timeoutMs: 60 });
    assert.equal(s.failed, 1); assert.equal(sig.aborted, true);
    assert.equal((await row(a, 'h')).last_status, 'timeout');
    assert.equal((await runs(a, 'h'))[0].error_code, 'timeout');
});

t('an action that throws or returns garbage is recorded as a code and never leaks the message', async () => {
    const a = await app(); await store.setJobs(a, [job('e1'), job('e2'), job('e3'), job('e4')]);
    const act = async ({ jobId }) => {
        if (jobId === 'e1') throw new Error('connection string postgres://u:SECRETPW@h/db');
        if (jobId === 'e2') return undefined;
        if (jobId === 'e3') return { ok: false, code: 'Bad Code with SECRETPW!' };
        return { ok: false };
    };
    const s = await tick(T0 + HOUR, act);
    assert.equal(s.failed, 4);
    const codes = Object.fromEntries((await runs(a)).map((r) => [r.job_id, r.error_code]));
    assert.deepEqual(codes, { e1: 'internal_error', e2: 'internal_error', e3: 'unknown_error', e4: 'unknown_error' });
    assert.ok(!JSON.stringify(await runs(a)).includes('SECRETPW'));
    assert.ok(!JSON.stringify(await db.pool.query('select * from platform.jobs where app_id = $1', [a]).then((r) => r.rows)).includes('SECRETPW'));
});

t('concurrency is capped per tick and across ticks that share a gate', async () => {
    const apps = []; for (let i = 0; i < 3; i++) { const a = await app(); apps.push(a); await store.setJobs(a, [job('g1'), job('g2'), job('g3')]); }
    let active = 0; let peak = 0;
    const act = async () => { active++; peak = Math.max(peak, active); await sleep(50); active--; return { ok: true }; };
    await tick(T0 + HOUR, act, { concurrency: 2, limit: 9 });
    assert.equal(peak, 2);
    peak = 0;
    const gate = createGate(3);
    await Promise.all([tick(T0 + 3 * HOUR, act, { gate, limit: 5 }), tick(T0 + 3 * HOUR, act, { gate, limit: 5 })]);
    assert.equal(peak, 3, 'shared gate: process-wide cap');
    assert.equal(DEFAULTS.concurrency, 3);
});

t('createGate queues beyond its capacity, releases on error, and reports active', async () => {
    const g = createGate(1);
    const order = [];
    const p1 = g.run(async () => { order.push('a-start'); await sleep(30); order.push('a-end'); });
    const p2 = g.run(async () => { order.push('b-start'); throw new Error('x'); });
    const p3 = g.run(async () => { order.push('c'); });
    assert.equal(g.active, 1);
    await p1; await assert.rejects(p2); await p3;
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'c']);
    assert.equal(g.active, 0);
});

t('a job replaced while it runs keeps its new definition and schedule', async () => {
    const a = await app(); await store.setJobs(a, [job('m')]);
    const s = tick(T0 + HOUR, async () => {
        await store.setJobs(a, [{ id: 'm', schedule: { every: '6h' }, action: { ...PRUNE, olderThanDays: 5 } }]);
        return { ok: false, code: 'upstream_500' };
    });
    await s;
    const r = await row(a, 'm');
    assert.equal(r.spec.action.olderThanDays, 5); assert.equal(r.failures, 0); assert.equal(r.last_status, null);
    assert.equal(ms(r.next_run_at), T0 + 6 * HOUR, 'the new definition was scheduled by the store, not by the old run');
});

t('time can be given as a number, a Date or a function', async () => {
    const a = await app(); await store.setJobs(a, [job('t')]);
    assert.equal((await runDueJobs({ now: new Date(T0 + HOUR - 1), pool: db.pool, runAction: okAction })).claimed, 0);
    assert.equal((await runDueJobs({ now: T0 + HOUR, pool: db.pool, runAction: okAction })).claimed, 1);
    await db.pool.query('update platform.jobs set next_run_at = $2 where app_id = $1', [a, new Date(T0)]);
    assert.equal((await runDueJobs({ now: () => new Date(T0 + 1), pool: db.pool, runAction: okAction })).claimed, 1);
});

t('a claim failure rolls back and surfaces; nothing is left leased', async () => {
    const a = await app(); await store.setJobs(a, [job('q')]);
    const patched = [];
    const broken = { connect: async () => { const c = await db.pool.connect(); const orig = c.query; patched.push(() => { c.query = orig; }); const bound = orig.bind(c); c.query = async (sql, ...r) => { if (/insert into platform.job_runs/.test(String(sql))) throw new Error('disk full'); return bound(sql, ...r); }; return c; } };
    try { await assert.rejects(() => runDueJobs({ now: () => T0 + HOUR, pool: broken, runAction: okAction }), /disk full/); } finally { patched.forEach((f) => f()); }
    assert.equal(ms((await row(a, 'q')).next_run_at), T0 + HOUR, 'lease update rolled back');
    assert.equal((await runs(a)).length, 0);
    assert.equal((await tick(T0 + HOUR, okAction)).ok, 1);
});

t('a job whose row is locked by someone else is skipped, not waited for (SKIP LOCKED)', async () => {
    const a = await app(); await store.setJobs(a, [job('l1'), job('l2')]);
    const holder = await db.pool.connect();
    try {
        await holder.query('begin');
        await holder.query("select 1 from platform.jobs where app_id = $1 and job_id = 'l1' for update", [a]);
        const seen = [];
        const s = await Promise.race([tick(T0 + 2 * HOUR, async (x) => { seen.push(x.jobId); return { ok: true }; }), sleep(2000).then(() => 'blocked')]);
        assert.notEqual(s, 'blocked');
        assert.deepEqual(seen, ['l2']);
    } finally { await holder.query('rollback'); holder.release(); }
});
