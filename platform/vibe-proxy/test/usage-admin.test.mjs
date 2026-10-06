import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageAdmin } from '../usage-admin.js';
import { createLimitsResolver, defaultLimits } from '../usage.js';

const T = Date.UTC(2026, 9, 6, 12);
function rig({ apps = ['a'], rows = [], spec = { tables: { t1: {}, t2: {} } }, total = 12, files = { bytes: 5000, files: 3 }, counters = { 'calls:a:2026-10-06': 40, 'spend:a:2026-10-06': 1234 } } = {}) {
    const state = { overrides: {}, usageArgs: null, totalArgs: null };
    const limitsStore = { async get() { return state.overrides; }, async set(id, o) { if (!apps.includes(id)) return false; state.overrides = o; return true; } };
    const limitsResolver = createLimitsResolver({ defaults: defaultLimits(), load: async () => state.overrides, ttlMs: 60_000 });
    const h = createUsageAdmin({
        appStore: { async get(id) { return apps.includes(id) ? { enabled: true } : null; } },
        usageStore: { async usageDaily(id, args) { state.usageArgs = [id, args]; return rows; } },
        limitsStore, limitsResolver, defaults: defaultLimits(),
        executor: { async peekSpec() { return { spec, version: 1 }; }, async totalRows(id, tables) { state.totalArgs = tables; return total; } },
        storageStore: { async usage() { return files; } },
        limiterStore: { async get(k) { return counters[k] || 0; } }, now: () => T,
    });
    return { h, state, limitsResolver };
}
const get = (r, sub, q = '') => r.h({ appId: 'a', sub, method: 'GET', query: new URLSearchParams(q), readBody: async () => ({}) });
const post = (r, sub, value, appId = 'a') => r.h({ appId, sub, method: 'POST', query: new URLSearchParams(), readBody: async () => (value instanceof Error ? { error: 400 } : { value }) });

test('usage: days default to 7, accept 1..30 and reject everything else', async () => {
    const r = rig();
    assert.equal((await get(r, 'usage')).body.days.length, 7);
    assert.equal((await get(r, 'usage', 'days=30')).body.days.length, 30);
    assert.equal((await get(r, 'usage', 'days=1')).body.days.length, 1);
    assert.deepEqual(r.state.usageArgs, ['a', { days: 1, today: '2026-10-06' }]);
    for (const bad of ['0', '31', '-1', '1.5', 'x', '', '07x', '100', '007']) assert.equal((await get(r, 'usage', `days=${bad}`)).status, 400, bad);
});

test('usage: unknown app is 404, wrong method is 405', async () => {
    const r = rig();
    assert.equal((await r.h({ appId: 'nope', sub: 'usage', method: 'GET', query: new URLSearchParams(), readBody: async () => ({}) })).status, 404);
    assert.equal((await r.h({ appId: 'a', sub: 'usage', method: 'POST', query: new URLSearchParams(), readBody: async () => ({}) })).status, 405);
    assert.equal((await r.h({ appId: 'a', sub: 'limits', method: 'DELETE', query: new URLSearchParams(), readBody: async () => ({}) })).status, 405);
});

test('usage: reports current usage against each cap, from the live counters, the rollup and the storage and data stores', async () => {
    const rows = [
        { day: '2026-10-06', kind: 'auth_email', calls: 10, errors: 2, bytes: 0, rows: 0, ms: 0, spendMicros: 0 },
        { day: '2026-10-06', kind: 'notify', calls: 3, errors: 0, bytes: 0, rows: 0, ms: 0, spendMicros: 0 },
        { day: '2026-10-06', kind: 'job', calls: 4, errors: 1, bytes: 0, rows: 0, ms: 0, spendMicros: 0 },
        { day: '2026-10-05', kind: 'job', calls: 99, errors: 0, bytes: 0, rows: 0, ms: 0, spendMicros: 0 },
    ];
    const r = rig({ rows });
    const out = (await get(r, 'usage', 'days=2')).body;
    assert.deepEqual(out.usage, { rows: 12, storageBytes: 5000, files: 3, callsToday: 40, spendMicrosToday: 1234, emailsToday: 11, jobRunsToday: 4 });
    assert.deepEqual(r.state.totalArgs, ['t1', 't2']);
    assert.deepEqual(out.limits, defaultLimits());
    assert.equal(out.totals.job.calls, 103);
});

test('usage: an override shows in the limits; a store that fails reads as null, not as a made-up zero; no schema means zero rows', async () => {
    const r = rig();
    r.state.overrides = { rowCap: 500 };
    assert.equal((await get(r, 'usage')).body.limits.rowCap, 500);
    const bad = createUsageAdmin({ appStore: { async get() { return {}; } }, usageStore: { async usageDaily() { return []; } }, limitsStore: {}, limitsResolver: createLimitsResolver({ load: async () => ({}) }), defaults: {}, executor: { async peekSpec() { return { spec: { tables: { t: {} } } }; }, async totalRows() { throw new Error('x'); } }, storageStore: { async usage() { throw new Error('x'); } }, limiterStore: { async get() { throw new Error('x'); } }, now: () => T });
    const u = (await bad({ appId: 'a', sub: 'usage', method: 'GET', query: new URLSearchParams(), readBody: async () => ({}) })).body.usage;
    assert.deepEqual([u.rows, u.storageBytes, u.files, u.callsToday, u.spendMicrosToday], [null, null, null, null, null]);
    const none = rig({ spec: null });
    assert.equal((await get(none, 'usage')).body.usage.rows, 0);
    assert.equal(none.state.totalArgs, null);
});

test('usage: the response is numbers only (no strings anywhere under totals, days or usage)', async () => {
    const r = rig({ rows: [{ day: '2026-10-06', kind: 'db', calls: 1, errors: 0, bytes: 0, rows: 2, ms: 3, spendMicros: 0 }] });
    const out = (await get(r, 'usage')).body;
    const walk = (v, path) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`); else assert.ok(v === null || typeof v === 'number', `${path} = ${v}`); };
    walk(out.totals, 'totals'); walk(out.usage, 'usage'); walk(out.limits, 'limits');
    for (const d of out.days) { assert.match(d.day, /^\d{4}-\d{2}-\d{2}$/); walk(d.byKind, d.day); }
});

test('limits GET shows defaults, overrides and the effective limits', async () => {
    const r = rig(); r.state.overrides = { dailyCalls: 77 };
    const out = (await get(r, 'limits')).body;
    assert.equal(out.defaults.dailyCalls, 5000); assert.deepEqual(out.overrides, { dailyCalls: 77 }); assert.equal(out.limits.dailyCalls, 77);
});

test('limits POST validates keys and ranges, stores overrides, and takes effect immediately (cache invalidated)', async () => {
    const r = rig();
    assert.equal((await get(r, 'limits')).body.limits.rowCap, 20000); // primes the cache
    const ok = await post(r, 'limits', { overrides: { rowCap: 1000, dailyCalls: 50 } });
    assert.equal(ok.status, 200); assert.deepEqual(ok.body.overrides, { rowCap: 1000, dailyCalls: 50 }); assert.equal(ok.body.limits.rowCap, 1000);
    assert.equal((await get(r, 'limits')).body.limits.rowCap, 1000);
    for (const bad of [{}, { overrides: null }, { overrides: { nope: 1 } }, { overrides: { rowCap: 1 } }, { overrides: { rowCap: 1e12 } }, { overrides: { rowCap: '5000' } }, { overrides: [1] }]) {
        const res = await post(r, 'limits', bad);
        assert.equal(res.status, 400, JSON.stringify(bad)); assert.equal(res.body.error, 'invalid_limits');
    }
    assert.deepEqual(r.state.overrides, { rowCap: 1000, dailyCalls: 50 }, 'a rejected request changes nothing');
    assert.equal((await post(r, 'limits', { overrides: {} })).status, 200);
    assert.equal((await get(r, 'limits')).body.limits.rowCap, 20000);
    assert.equal((await post(r, 'limits', new Error('bad'))).status, 400);
});
