import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsage, kindForRoute, validateOverrides, resolveLimits, buildUsageReport, createLimitsResolver, LIMIT_DEFS, KINDS, emailsFrom, billableUnits } from '../usage.js';

const T = Date.UTC(2026, 9, 6, 12, 0, 0);

test('kindForRoute maps every platform route to a kind and ignores unknown ones', () => {
    assert.equal(kindForRoute('db'), 'db');
    assert.equal(kindForRoute('storage/upload'), 'storage_upload');
    assert.equal(kindForRoute('storage/url'), 'storage_download');
    assert.equal(kindForRoute('storage/list'), 'storage_other');
    assert.equal(kindForRoute('storage/delete'), 'storage_other');
    assert.equal(kindForRoute('auth/request'), 'auth_email');
    assert.equal(kindForRoute('auth/consume'), 'auth_signin');
    assert.equal(kindForRoute('auth/me'), 'auth_session');
    assert.equal(kindForRoute('notify/me'), 'notify');
    assert.equal(kindForRoute('pay/checkout'), 'pay_checkout');
    assert.equal(kindForRoute('pay/webhook'), 'pay_webhook');
    assert.equal(kindForRoute('pay/orders'), 'pay_orders');
    assert.equal(kindForRoute('ai'), 'ai');
    assert.equal(kindForRoute('api'), 'api');
    assert.equal(kindForRoute('admin'), null);
    assert.equal(kindForRoute('nonsense'), null);
    assert.equal(kindForRoute('constructor'), null);
    assert.equal(kindForRoute('toString'), null);
    for (const r of ['db', 'storage/upload', 'auth/request', 'notify/me', 'pay/checkout', 'ai', 'api']) assert.ok(KINDS.includes(kindForRoute(r)));
});

test('record sends one counts-only event per call and counts errors from status or ok', async () => {
    const seen = [];
    const u = createUsage({ sink: async (e) => { seen.push(e); }, now: () => T });
    await u.record({ appId: 'a', kind: 'db', status: 200, rows: 3, ms: 12 });
    await u.record({ appId: 'a', kind: 'db', status: 429, ms: 1 });
    await u.record({ appId: 'a', kind: 'job', ok: false, ms: 5 });
    await u.record({ appId: 'a', kind: 'job', ok: true, ms: 5 });
    await u.record({ appId: 'a', kind: 'db', status: 400 });
    await u.record({ appId: 'a', kind: 'db', status: 399 });
    assert.deepEqual(seen.slice(4).map((e) => e.errors), [1, 0]); seen.length = 4;
    assert.deepEqual(seen.map((e) => [e.kind, e.calls, e.errors, e.rows, e.ms]), [['db', 1, 0, 3, 12], ['db', 1, 1, 0, 1], ['job', 1, 1, 0, 5], ['job', 1, 0, 0, 5]]);
    assert.equal(seen[0].day, '2026-10-06');
});

test('record never stores anything but numbers, the app id, kind and day (no bodies, emails or tokens)', async () => {
    const seen = [];
    const u = createUsage({ sink: async (e) => { seen.push(e); }, now: () => T });
    await u.record({ appId: 'a', kind: 'auth_email', status: 200, email: 'x@y.z', body: 'secret', token: 'tok', rows: 1, bytes: 2 });
    assert.deepEqual(Object.keys(seen[0]).sort(), ['appId', 'bytes', 'calls', 'day', 'errors', 'kind', 'ms', 'rows', 'spendMicros']);
    assert.ok(!JSON.stringify(seen[0]).includes('secret') && !JSON.stringify(seen[0]).includes('x@y.z'));
});

test('record drops unknown kinds, bad app ids and negative or non-finite numbers; a failing sink never throws', async () => {
    const seen = [];
    const u = createUsage({ sink: async (e) => { seen.push(e); }, now: () => T });
    await u.record({ appId: 'a', kind: 'bogus', status: 200 });
    await u.record({ appId: '', kind: 'db', status: 200 });
    await u.record({ appId: 'a', kind: 'db', status: 200, rows: -5, bytes: NaN, ms: Infinity });
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0].rows, seen[0].bytes, seen[0].ms], [0, 0, 0]);
    const bad = createUsage({ sink: async () => { throw new Error('db down'); }, now: () => T });
    await assert.doesNotReject(bad.record({ appId: 'a', kind: 'db', status: 200 }));
});

test('buffered mode merges calls into one row per (app, day, kind) and flush writes them', async () => {
    const seen = [];
    const u = createUsage({ sink: async (e) => { seen.push(e); }, now: () => T, flushMs: 60_000 });
    for (let i = 0; i < 5; i++) await u.record({ appId: 'a', kind: 'db', status: i === 0 ? 500 : 200, rows: 2, ms: 10 });
    await u.record({ appId: 'b', kind: 'db', status: 200 });
    assert.equal(seen.length, 0);
    await u.flush();
    assert.equal(seen.length, 2);
    const a = seen.find((e) => e.appId === 'a');
    assert.deepEqual([a.calls, a.errors, a.rows, a.ms], [5, 1, 10, 50]);
    await u.flush();
    assert.equal(seen.length, 2);
    await u.close();
});

test('a failed flush keeps the events so the next flush retries them', async () => {
    let fail = true; const seen = [];
    const u = createUsage({ sink: async (e) => { if (fail) throw new Error('x'); seen.push(e); }, now: () => T, flushMs: 60_000 });
    await u.record({ appId: 'a', kind: 'db', status: 200 });
    await u.flush();
    assert.equal(seen.length, 0);
    fail = false;
    await u.flush();
    assert.equal(seen.length, 1);
    await u.close();
});

test('validateOverrides accepts known integer keys in range and rejects the rest', () => {
    assert.deepEqual(validateOverrides({ rowCap: 50_000, dailyCalls: 1000 }), { ok: true, overrides: { rowCap: 50_000, dailyCalls: 1000 } });
    assert.deepEqual(validateOverrides({}), { ok: true, overrides: {} });
    for (const bad of [null, [], 'x', { nope: 1 }, { rowCap: 'a' }, { rowCap: 1.5 }, { rowCap: -1 }, { rowCap: 0 }, { rowCap: LIMIT_DEFS.rowCap.max + 1 }, { rowCap: Infinity }, { dailySpendMicros: -1 }]) {
        const r = validateOverrides(bad);
        assert.equal(r.ok, false, JSON.stringify(bad));
        assert.ok(Array.isArray(r.errors) && r.errors.length);
    }
    assert.equal(validateOverrides({ __proto__: 1, constructor: 1 }).ok, false);
    assert.equal(validateOverrides({ dailySpendMicros: 0 }).ok, true);
});

test('resolveLimits layers overrides over defaults and ignores junk in stored overrides', () => {
    const d = { rowCap: 20000, dailyCalls: 5000 };
    assert.deepEqual(resolveLimits(d, { rowCap: 100 }), { rowCap: 100, dailyCalls: 5000 });
    assert.deepEqual(resolveLimits(d, { rowCap: 'x', other: 1 }), d);
    assert.deepEqual(resolveLimits(d, null), d);
    assert.equal(LIMIT_DEFS.rowCap.default, 20000);
});

test('createLimitsResolver caches per app, can be invalidated, and falls back to defaults if the store fails', async () => {
    let t = 0; let n = 0; let boom = false;
    const r = createLimitsResolver({ defaults: { rowCap: 20000 }, load: async () => { n++; if (boom) throw new Error('x'); return { rowCap: 7 }; }, now: () => t, ttlMs: 1000 });
    assert.equal((await r.limitsFor('a')).rowCap, 7);
    await r.limitsFor('a'); assert.equal(n, 1);
    t = 1001; await r.limitsFor('a'); assert.equal(n, 2);
    r.invalidate('a'); await r.limitsFor('a'); assert.equal(n, 3);
    boom = true; r.invalidate('a');
    assert.equal((await r.limitsFor('a')).rowCap, 20000);
});

test('buildUsageReport returns a contiguous day list, per-kind totals and numbers only', () => {
    const rows = [
        { day: '2026-10-06', kind: 'db', calls: 10, errors: 1, bytes: 0, rows: 40, ms: 100, spendMicros: 0 },
        { day: '2026-10-04', kind: 'db', calls: 5, errors: 0, bytes: 0, rows: 5, ms: 50, spendMicros: 0 },
        { day: '2025-01-01', kind: 'db', calls: 99, errors: 0, bytes: 0, rows: 0, ms: 0, spendMicros: 0 },
        { day: '2026-10-06', kind: 'ai', calls: 2, errors: 0, bytes: 0, rows: 0, ms: 900, spendMicros: 3000 },
    ];
    const r = buildUsageReport({ days: 3, today: '2026-10-06', rows, limits: { rowCap: 20000 }, usage: { rows: 12 } });
    assert.deepEqual(r.days.map((d) => d.day), ['2026-10-04', '2026-10-05', '2026-10-06']);
    assert.deepEqual(r.days[1].byKind, {});
    assert.equal(r.days[2].byKind.db.calls, 10);
    assert.equal(r.totals.db.calls, 15);
    assert.equal(r.totals.db.errors, 1);
    assert.equal(r.totals.ai.spendMicros, 3000);
    assert.deepEqual(r.limits, { rowCap: 20000 });
    assert.deepEqual(r.usage, { rows: 12 });
});

test('emailsFrom counts sent mail: auth_email and notify calls minus errors', () => {
    assert.equal(emailsFrom({ auth_email: { calls: 10, errors: 3 }, notify: { calls: 4, errors: 1 }, db: { calls: 99, errors: 0 } }), 10);
    assert.equal(emailsFrom({}), 0);
});

test('calls: 0 records spend or bytes without counting another call (AI spend lands after the call is metered)', async () => {
    const seen = [];
    const u = createUsage({ sink: async (e) => { seen.push(e); }, now: () => T });
    await u.record({ appId: 'a', kind: 'ai', calls: 0, spendMicros: 4200, status: 500 });
    assert.deepEqual([seen[0].calls, seen[0].errors, seen[0].spendMicros], [0, 0, 4200]);
});

test('a flush drops events the database can never accept (constraint/data errors) instead of retrying forever, but keeps them on other errors', async () => {
    let code = '23503'; let attempts = 0;
    const u = createUsage({ sink: async () => { attempts++; const e = new Error('x'); e.code = code; throw e; }, now: () => T, flushMs: 60_000 });
    await u.record({ appId: 'ghost', kind: 'db', status: 200 });
    await u.flush(); await u.flush();
    assert.equal(attempts, 1, 'dropped after the first failure');
    code = '08006'; await u.record({ appId: 'a', kind: 'db', status: 200 });
    await u.flush(); await u.flush();
    assert.equal(attempts, 3, 'kept and retried');
    await u.close();
});

test('the in-memory buffer is bounded: new keys are dropped past the cap, existing keys keep merging', async () => {
    const seen = [];
    const u = createUsage({ sink: async (e) => { seen.push(e); }, now: () => T, flushMs: 60_000 });
    for (let i = 0; i < 5100; i++) await u.record({ appId: `app-${i}`, kind: 'db', status: 200 });
    await u.record({ appId: 'app-0', kind: 'db', status: 200 });
    await u.flush();
    assert.equal(seen.length, 5000);
    assert.equal(seen.find((e) => e.appId === 'app-0').calls, 2);
    await u.close();
});

test('billableUnits turns totals into units only (no prices), counting successes for downloads, emails and checkouts', () => {
    const c = (calls, o = {}) => ({ calls, errors: 0, bytes: 0, rows: 0, ms: 0, spendMicros: 0, ...o });
    const u = billableUnits({
        db: c(10, { rows: 300 }), api: c(4), ai: c(3, { spendMicros: 7000 }), auth_email: c(5, { errors: 2 }), notify: c(2), storage_upload: c(2, { bytes: 4096 }),
        storage_download: c(6, { errors: 1 }), job: c(8), pay_checkout: c(3, { errors: 1 }), pay_webhook: c(9),
    });
    assert.deepEqual(u, { requests: 10 + 4 + 3 + 5 + 2 + 2 + 6 + 3, aiSpendMicros: 7000, dbRowsReturned: 300, uploadBytes: 4096, downloads: 5, emailsSent: 5, jobRuns: 8, payCheckouts: 2 });
    assert.deepEqual(billableUnits({}), { requests: 0, aiSpendMicros: 0, dbRowsReturned: 0, uploadBytes: 0, downloads: 0, emailsSent: 0, jobRuns: 0, payCheckouts: 0 });
    assert.deepEqual(billableUnits(undefined), billableUnits({}));
});
