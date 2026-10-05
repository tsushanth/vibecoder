import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../start.js';
import { loadConfig } from '../config.js';
import { createDataExecutor } from '../../data/executor.js';
import { validateSpec } from '../../data/schema.js';

const ADMIN_T = 'admin-' + 'j'.repeat(40);
let db, skip, MK, ex;
before(async () => { db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; } MK = masterKey(); ex = createDataExecutor({ pool: db.pool }); });
after(async () => { if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const env = (extra = {}) => ({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: MK ?? 'a'.repeat(64), OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PROXY_ADMIN_TOKEN: ADMIN_T, ...extra });
const cfg = (extra) => loadConfig(env(extra));
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const url = (s, p) => `http://127.0.0.1:${s.port}${p}`;
const adminCall = (s, method, p, body, token = ADMIN_T) => fetch(url(s, p), { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'fly-client-ip': '8.8.4.4' }, body: body === undefined ? undefined : JSON.stringify(body) });
const feedFetch = (log) => async (u) => { log.push(String(u)); return new Response(JSON.stringify({ properties: { temp: 12.5 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
const boot = (extra, deps = {}) => startServer(cfg(extra), { pool: db.pool, listenPort: 0, resolve: async () => ['93.184.216.34'], ...deps });
const SPEC = validateSpec({ version: 1, tables: { readings: { access: 'public_read', columns: { temp: { type: 'number' } } } } }).spec;
const JOB = { id: 'wx', schedule: { every: '15m' }, action: { type: 'connector', connector: 'nws', method: 'GET', path: '/alerts/active', save: { table: 'readings', map: { temp: '/properties/temp' } } } };

test('config: jobs are off unless JOBS_ENABLED is exactly "true"; tick interval is bounded', () => {
    const base = env();
    assert.equal(loadConfig(base).jobsEnabled, false);
    assert.equal(loadConfig(base).jobsTickMs, 30_000);
    assert.equal(loadConfig({ ...base, JOBS_ENABLED: 'true' }).jobsEnabled, true);
    for (const v of ['TRUE', 'True', '1', 'yes', 'false', '', ' true', 'true ']) assert.equal(loadConfig({ ...base, JOBS_ENABLED: v }).jobsEnabled, false, JSON.stringify(v));
    assert.equal(loadConfig({ ...base, JOBS_TICK_MS: '5000' }).jobsTickMs, 5000);
    for (const v of ['999', '600001', 'abc', '1.5']) assert.throws(() => loadConfig({ ...base, JOBS_TICK_MS: v }), /JOBS_TICK_MS/, v);
});

t('the jobs admin endpoint needs the admin token and stores a validated list', async () => {
    const s = await boot(); const a = 'wire-admin';
    try {
        await s.stores.upsertApp({ appId: a, enabled: true });
        assert.equal((await adminCall(s, 'GET', `/admin/apps/${a}/jobs`, undefined, 'wrong-token')).status, 401);
        assert.equal((await fetch(url(s, `/admin/apps/${a}/jobs`))).status, 401);
        assert.deepEqual(await (await adminCall(s, 'GET', `/admin/apps/${a}/jobs`)).json(), { jobs: [], runs: [] });
        assert.equal((await adminCall(s, 'GET', '/admin/apps/ghost-app/jobs')).status, 404);
        assert.equal((await adminCall(s, 'DELETE', `/admin/apps/${a}/jobs`)).status, 405);
        assert.equal((await adminCall(s, 'GET', `/admin/apps/${a}/jobs/extra`)).status, 404);
        const bad = await adminCall(s, 'POST', `/admin/apps/${a}/jobs`, { jobs: [{ id: 'n', schedule: { every: '1h' }, action: { type: 'notify' } }] });
        assert.equal(bad.status, 400); assert.equal((await bad.json()).problems[0].code, 'not_yet');
        assert.equal((await ex.applySchema({ appId: a, spec: SPEC })).ok, true);
        const ok = await adminCall(s, 'POST', `/admin/apps/${a}/jobs`, { jobs: [JOB] });
        assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { jobs: 1, warnings: [] });
        const got = await (await adminCall(s, 'GET', `/admin/apps/${a}/jobs`)).json();
        assert.equal(got.jobs.length, 1); assert.equal(got.jobs[0].id, 'wx');
        const huge = await adminCall(s, 'POST', `/admin/apps/${a}/jobs`, { jobs: [], pad: 'x'.repeat(9000) });
        assert.equal(huge.status, 413);
        const notJson = await fetch(url(s, `/admin/apps/${a}/jobs`), { method: 'POST', headers: { authorization: `Bearer ${ADMIN_T}`, 'fly-client-ip': '8.8.4.4' }, body: '{nope' });
        assert.equal(notJson.status, 400);
    } finally { await s.close(); }
});

t('with JOBS_ENABLED unset the scheduler does not exist and due jobs do not run', async () => {
    const calls = []; const a = 'wire-off';
    const s = await boot({}, { jobsTickMs: 20, fetchImpl: feedFetch(calls) });
    try {
        assert.equal(s.scheduler, null);
        await s.stores.upsertApp({ appId: a, enabled: true }); await ex.applySchema({ appId: a, spec: SPEC });
        assert.equal((await adminCall(s, 'POST', `/admin/apps/${a}/jobs`, { jobs: [JOB] })).status, 200);
        await db.pool.query("update platform.jobs set next_run_at = now() - interval '1 hour' where app_id = $1", [a]);
        await sleep(200);
        assert.equal(calls.length, 0);
        assert.equal((await db.pool.query('select count(*)::int n from platform.job_runs where app_id = $1', [a])).rows[0].n, 0);
    } finally { await s.close(); await db.pool.query('delete from platform.jobs'); }
});

t('with JOBS_ENABLED=true a due job calls the connector, saves the row, records the run, and close() stops the scheduler', async () => {
    const calls = []; const a = 'wire-on';
    const s = await boot({ JOBS_ENABLED: 'true' }, { jobsTickMs: 20, fetchImpl: feedFetch(calls) });
    try {
        assert.ok(s.scheduler);
        await s.stores.upsertApp({ appId: a, enabled: true }); await ex.applySchema({ appId: a, spec: SPEC });
        assert.equal((await adminCall(s, 'POST', `/admin/apps/${a}/jobs`, { jobs: [JOB] })).status, 200);
        await sleep(100);
        assert.equal(calls.length, 0, 'not due yet: first run is one interval after declaring');
        await db.pool.query("update platform.jobs set next_run_at = now() - interval '1 minute' where app_id = $1", [a]);
        let runs = [];
        for (let i = 0; i < 100 && !runs.length; i++) { await sleep(30); runs = (await db.pool.query("select * from platform.job_runs where app_id = $1 and status <> 'running'", [a])).rows; }
        assert.equal(runs.length, 1); assert.equal(runs[0].status, 'ok'); assert.equal(runs[0].error_code, null);
        assert.deepEqual(calls, ['https://api.weather.gov/alerts/active']);
        const schema = (await db.pool.query('select schema_name from platform.app_dbs where app_id = $1', [a])).rows[0].schema_name;
        assert.deepEqual((await db.pool.query(`select temp from "${schema}".readings`)).rows, [{ temp: 12.5 }]);
        const g = await (await adminCall(s, 'GET', `/admin/apps/${a}/jobs`)).json();
        assert.equal(g.runs[0].status, 'ok'); assert.equal(g.jobs[0].lastStatus, 'ok');
        assert.equal((await db.pool.query("select count(*)::int n from platform.usage_events where app_id = $1 and connector = 'nws'", [a])).rows[0].n, 1, 'the call was metered like any proxy call');
    } finally { await s.close(); }
    const before = (await db.pool.query('select count(*)::int n from platform.job_runs where app_id = $1', [a])).rows[0].n;
    await db.pool.query("update platform.jobs set next_run_at = now() - interval '1 minute' where app_id = $1", [a]);
    await sleep(150);
    assert.equal((await db.pool.query('select count(*)::int n from platform.job_runs where app_id = $1', [a])).rows[0].n, before, 'nothing runs after close');
});

t('a tick that errors is logged by code only and does not stop the scheduler', async () => {
    const logs = [];
    const s = await boot({ JOBS_ENABLED: 'true' }, { jobsTickMs: 20, log: (l) => logs.push(l) });
    try {
        await db.pool.query('alter table platform.job_runs rename to job_runs_x');
        try { await sleep(120); } finally { await db.pool.query('alter table platform.job_runs_x rename to job_runs'); }
        const errs = logs.filter((l) => l.includes('jobs_tick_error'));
        assert.ok(errs.length >= 2, 'kept ticking after errors');
        assert.ok(errs.every((l) => /"code":"[A-Za-z0-9_]+"/.test(l) && !l.includes('job_runs')), errs[0]);
    } finally { await s.close(); }
});
