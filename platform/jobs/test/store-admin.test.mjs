import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createDataExecutor } from '../../data/executor.js';
import { validateSpec } from '../../data/schema.js';
import { createJobsStore } from '../store.js';
import { createJobsAdmin, JOBS_BODY_LIMIT } from '../admin.js';

const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
const HOUR = 3_600_000;
const PRUNE = { type: 'prune', table: 'readings', olderThanDays: 30 };
const job = (id, schedule = { every: '1h' }, action = PRUNE) => ({ id, schedule, action });
let db, skip, stores, clock = T0, store, proxyPool, ex, admin, seq = 0;
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    await db.admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname='proxy_sim') then create role proxy_sim login in role vibe_proxy; end if; end $$");
    stores = createPgStores({ pool: db.pool, masterKey: masterKey() });
    store = createJobsStore({ pool: db.pool, now: () => clock });
    proxyPool = db.connFor({ user: 'proxy_sim', max: 3 });
    ex = createDataExecutor({ pool: proxyPool });
    admin = createJobsAdmin({ store, appStore: stores.appStore });
});
after(async () => { await proxyPool?.end().catch(() => {}); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); clock = T0; await f(c); });
const app = async (manifest = null) => { const id = `sa-${++seq}`; await stores.upsertApp({ appId: id, enabled: true, manifest }); return id; };
const body = (value, error) => async (limit) => (error ? { error } : { value, limit });
const post = (appId, value, error) => admin({ appId, method: 'POST', readBody: body(value, error) });
const withSchema = async (appId) => assert.equal((await ex.applySchema({ appId, spec: validateSpec({ version: 1, tables: { readings: { access: 'public_read', columns: { temp: { type: 'number' }, note: { type: 'text' } } }, mine: { access: 'owner', columns: { x: { type: 'text' } } } } }).spec })).ok, true);
const rows = async (appId) => (await db.pool.query('select * from platform.jobs where app_id = $1 order by job_id', [appId])).rows;

t('setJobs inserts jobs with the first run one schedule step away', async () => {
    const a = await app();
    await store.setJobs(a, [job('a'), job('b', { every: '15m' }), job('c', { dailyAt: '10:00', tz: 'UTC' })]);
    const r = await rows(a);
    assert.deepEqual(r.map((x) => [x.job_id, x.next_run_at.getTime(), x.enabled, x.failures, x.last_status]), [
        ['a', T0 + HOUR, true, 0, null], ['b', T0 + 15 * 60_000, true, 0, null], ['c', Date.UTC(2026, 10, 15, 10, 0), true, 0, null]]);
    assert.deepEqual(r[0].spec, { schedule: { every: '1h' }, action: PRUNE });
});

t('setJobs removes jobs that are no longer listed, and an empty list clears them', async () => {
    const a = await app(); const b = await app();
    await store.setJobs(a, [job('a'), job('b'), job('c')]); await store.setJobs(b, [job('a')]);
    await store.setJobs(a, [job('b')]);
    assert.deepEqual((await rows(a)).map((x) => x.job_id), ['b']);
    assert.equal((await rows(b)).length, 1, 'another app is untouched');
    await store.setJobs(a, []);
    assert.equal((await rows(a)).length, 0);
    assert.equal((await rows(b)).length, 1);
});

t('an unchanged job keeps its place in the schedule and its failure count; a changed one starts over', async () => {
    const a = await app();
    await store.setJobs(a, [job('keep'), job('edit')]);
    await db.pool.query("update platform.jobs set next_run_at = $2, failures = 3, last_status = 'upstream_500', last_run_at = $3 where app_id = $1", [a, new Date(T0 + 5 * HOUR), new Date(T0)]);
    clock = T0 + 2 * HOUR;
    await store.setJobs(a, [job('keep'), job('edit', { every: '1h' }, { ...PRUNE, olderThanDays: 7 })]);
    const [edit, keep] = await rows(a);
    assert.deepEqual([keep.next_run_at.getTime(), keep.failures, keep.last_status], [T0 + 5 * HOUR, 3, 'upstream_500']);
    assert.deepEqual([edit.next_run_at.getTime(), edit.failures, edit.last_status, edit.spec.action.olderThanDays], [T0 + 3 * HOUR, 0, null, 7]);
    assert.ok(keep.last_run_at, 'history of an unchanged job is kept');
});

t('key order does not make a job look changed (jsonb equality)', async () => {
    const a = await app();
    await store.setJobs(a, [{ id: 'k', schedule: { every: '1h' }, action: { type: 'prune', table: 'readings', olderThanDays: 30 } }]);
    await db.pool.query('update platform.jobs set failures = 2 where app_id = $1', [a]);
    await store.setJobs(a, [{ id: 'k', schedule: { every: '1h' }, action: { olderThanDays: 30, table: 'readings', type: 'prune' } }]);
    assert.equal((await rows(a))[0].failures, 2);
});

t('re-posting an auto-disabled job re-enables it with a clean slate; a changed schedule is rescheduled', async () => {
    const a = await app();
    await store.setJobs(a, [job('d')]);
    await db.pool.query("update platform.jobs set enabled = false, failures = 5, last_status = 'auto_disabled', next_run_at = $2 where app_id = $1", [a, new Date(T0 - HOUR)]);
    clock = T0 + 3 * HOUR;
    await store.setJobs(a, [job('d')]);
    let r = (await rows(a))[0];
    assert.deepEqual([r.enabled, r.failures, r.last_status, r.next_run_at.getTime()], [true, 0, null, T0 + 4 * HOUR]);
    await store.setJobs(a, [job('d', { every: '6h' })]);
    r = (await rows(a))[0];
    assert.equal(r.next_run_at.getTime(), T0 + 9 * HOUR);
});

t('setJobs is atomic: a failure part way leaves the old list', async () => {
    const a = await app();
    await store.setJobs(a, [job('one')]);
    await assert.rejects(() => store.setJobs(a, [job('two'), { ...job('bad_id_with_a_very_long_name_that_exceeds_the_check_constraint_limit') }]));
    assert.deepEqual((await rows(a)).map((x) => x.job_id), ['one']);
});

t('jobs and their runs are deleted with the app', async () => {
    const a = await app(); await store.setJobs(a, [job('z')]);
    await db.pool.query("insert into platform.job_runs (app_id, job_id, started_at, status) values ($1, 'z', now(), 'ok')", [a]);
    await db.pool.query('delete from platform.apps where app_id = $1', [a]);
    assert.equal((await rows(a)).length, 0);
    assert.equal((await db.pool.query('select 1 from platform.job_runs where app_id = $1', [a])).rowCount, 0);
});

t('getJobs and recentRuns return state without any secrets or bodies, newest runs first', async () => {
    const a = await app(); await store.setJobs(a, [job('g')]);
    for (let i = 0; i < 25; i++) await db.pool.query("insert into platform.job_runs (app_id, job_id, started_at, finished_at, status, error_code) values ($1, 'g', $2, $2, $3, $4)", [a, new Date(T0 + i * 1000), i % 2 ? 'error' : 'ok', i % 2 ? 'upstream_500' : null]);
    const jobs = await store.getJobs(a);
    assert.equal(jobs.length, 1);
    assert.deepEqual(Object.keys(jobs[0]).sort(), ['action', 'enabled', 'failures', 'id', 'lastRunAt', 'lastStatus', 'nextRunAt', 'schedule']);
    const runs = await store.recentRuns(a);
    assert.equal(runs.length, 20); assert.equal(runs[0].startedAt.getTime(), T0 + 24 * 1000);
    assert.deepEqual(Object.keys(runs[0]).sort(), ['errorCode', 'finishedAt', 'jobId', 'startedAt', 'status']);
    assert.equal((await store.recentRuns(a, 3)).length, 3);
});

t('getSpec reads the stored schema without provisioning a database', async () => {
    const a = await app();
    assert.equal(await store.getSpec(a), null);
    assert.equal((await db.pool.query('select 1 from platform.app_dbs where app_id = $1', [a])).rowCount, 0, 'no role or schema was created');
    await withSchema(a);
    assert.deepEqual(Object.keys((await store.getSpec(a)).tables).sort(), ['mine', 'readings']);
});

// ---------- admin handler ----------
t('GET returns the job list and recent runs; unknown app is 404; other methods 405', async () => {
    const a = await app();
    assert.deepEqual(await admin({ appId: a, method: 'GET', readBody: body() }), { status: 200, body: { jobs: [], runs: [] } });
    assert.deepEqual(await admin({ appId: 'nobody', method: 'GET', readBody: body() }), { status: 404, body: { error: 'unknown_app' } });
    assert.deepEqual(await admin({ appId: 'nobody', method: 'POST', readBody: body({ jobs: [] }) }), { status: 404, body: { error: 'unknown_app' } });
    for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal((await admin({ appId: a, method, readBody: body() })).status, 405, method);
});

t('POST validates against the app schema and manifest, stores the jobs, and GET shows them', async () => {
    const a = await app({ connectors: { feed: { host: 'feed.example.com', paths: ['/v1/*'], methods: ['GET'] } } });
    await withSchema(a);
    const jobs = [
        { id: 'wx', schedule: { every: '1h' }, action: { type: 'connector', connector: 'nws', method: 'GET', path: '/alerts/active', save: { table: 'readings', map: { temp: '/t' } } } },
        { id: 'feed', schedule: { every: '6h' }, action: { type: 'connector', connector: 'feed', method: 'GET', path: '/v1/x', save: { table: 'readings', map: { note: '/n' } } } },
        job('clean', { dailyAt: '03:00', tz: 'UTC' }),
    ];
    const r = await post(a, { jobs });
    assert.deepEqual(r, { status: 200, body: { jobs: 3, warnings: [] } });
    const g = await admin({ appId: a, method: 'GET', readBody: body() });
    assert.deepEqual(g.body.jobs.map((j) => j.id), ['clean', 'feed', 'wx']);
    assert.equal(g.body.jobs[2].enabled, true);
    const posted = await post(a, { jobs: [jobs[2]] });
    assert.equal(posted.status, 200);
    assert.deepEqual((await admin({ appId: a, method: 'GET', readBody: body() })).body.jobs.map((j) => j.id), ['clean']);
});

t('POST rejects bad jobs with codes and stores nothing', async () => {
    const a = await app(); await withSchema(a);
    const cases = {
        not_yet: { jobs: [{ id: 'n', schedule: { every: '1h' }, action: { type: 'notify' } }] },
        bad_schedule: { jobs: [{ id: 'f', schedule: { every: '1m' }, action: PRUNE }] },
        unknown_table: { jobs: [job('p', { every: '1h' }, { type: 'prune', table: 'nope', olderThanDays: 3 })] },
        unknown_connector: { jobs: [{ id: 'c', schedule: { every: '1h' }, action: { type: 'connector', connector: 'ghost', method: 'GET', path: '/x', save: { table: 'readings', map: { temp: '/t' } } } }] },
        unknown_column: { jobs: [{ id: 'c', schedule: { every: '1h' }, action: { type: 'connector', connector: 'nws', method: 'GET', path: '/alerts/active', save: { table: 'readings', map: { zzz: '/t' } } } }] },
        too_many_jobs: { jobs: Array.from({ length: 6 }, (_, i) => job(`j${i}`)) },
        no_jobs: {},
    };
    for (const [code, value] of Object.entries(cases)) {
        const r = await post(a, value);
        assert.equal(r.status, 400, code); assert.equal(r.body.error, 'invalid_jobs');
        assert.ok(r.body.problems.some((p) => p.code === code), `${code}: ${JSON.stringify(r.body.problems)}`);
    }
    assert.equal((await rows(a)).length, 0);
});

t('an app with no data schema can still prune nothing: tables are checked against an empty set', async () => {
    const a = await app();
    const r = await post(a, { jobs: [job('p')] });
    assert.equal(r.status, 400); assert.ok(r.body.problems.some((p) => p.code === 'unknown_table'));
});

t('problems list is capped, and warnings for owner tables are returned on success', async () => {
    const a = await app(); await withSchema(a);
    const many = { jobs: Array.from({ length: 5 }, (_, i) => ({ id: `Bad${i}`, schedule: { every: '1m' }, action: { type: 'x' }, a: 1, b: 2, c: 3, d: 4, e: 5 })) };
    assert.equal((await post(a, many)).body.problems.length, 20);
    const w = await post(a, { jobs: [{ id: 'o', schedule: { every: '1h' }, action: { type: 'connector', connector: 'nws', method: 'GET', path: '/alerts/active', save: { table: 'mine', map: { x: '/x' } } } }] });
    assert.deepEqual(w, { status: 200, body: { jobs: 1, warnings: [{ code: 'owner_table_rows_have_no_owner', job: 'o', table: 'mine' }] } });
});

t('body errors map to 413 and 400, and the body limit is passed through', async () => {
    const a = await app();
    assert.deepEqual(await post(a, undefined, 413), { status: 413, body: { error: 'request_too_large' } });
    assert.deepEqual(await post(a, undefined, 400), { status: 400, body: { error: 'bad_json' } });
    let seen; await admin({ appId: a, method: 'POST', readBody: async (l) => { seen = l; return { value: { jobs: [] } }; } });
    assert.equal(seen, JOBS_BODY_LIMIT); assert.equal(JOBS_BODY_LIMIT, 8192);
});
