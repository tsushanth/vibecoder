import test from 'node:test';
import assert from 'node:assert/strict';
import { TIER_MULTIPLIER, overridesForTier, sameOverrides } from '../../lib/tierLimits.js';
import { applyTierLimits, syncTierLimitsForUser, startTierSweep } from '../../services/tierSync.js';

const DEFAULTS = { rowCap: 20000, dailyCalls: 5000, dailySpendMicros: 50000, storageBytes: 209715200, storageFiles: 2000, emailsPerDay: 200, jobRunsPerDay: 300 };

test('tiers scale every cap by a fixed factor: Free keeps the defaults (no overrides), Pro x5, Team x20', () => {
    assert.deepEqual(TIER_MULTIPLIER, { free: 1, pro: 5, team: 20 });
    assert.deepEqual(overridesForTier('free', DEFAULTS), {});
    assert.deepEqual(overridesForTier('pro', DEFAULTS), { rowCap: 100000, dailyCalls: 25000, dailySpendMicros: 250000, storageBytes: 1048576000, storageFiles: 10000, emailsPerDay: 1000, jobRunsPerDay: 1500 });
    assert.equal(overridesForTier('team', DEFAULTS).rowCap, 400000); assert.equal(overridesForTier('team', DEFAULTS).dailySpendMicros, 1000000);
});

test('an unknown or odd tier, or missing defaults, never raises anything', () => {
    for (const t of ['enterprise', '', undefined, null, 5, '__proto__', 'constructor']) assert.deepEqual(overridesForTier(t, DEFAULTS), {}, String(t));
    for (const d of [undefined, null, 'x', 5]) assert.deepEqual(overridesForTier('pro', d), {});
    assert.deepEqual(overridesForTier('pro', { rowCap: 1.5, bad: 'x', neg: -1, ok: 10 }), { ok: 50 }); // only whole non-negative numbers are scaled
});

test('sameOverrides compares key sets and values, ignoring order', () => {
    assert.equal(sameOverrides({ a: 1, b: 2 }, { b: 2, a: 1 }), true); assert.equal(sameOverrides({}, undefined), true); assert.equal(sameOverrides(null, {}), true);
    assert.equal(sameOverrides({ a: 1 }, { a: 2 }), false); assert.equal(sameOverrides({ a: 1 }, { a: 1, b: 2 }), false); assert.equal(sameOverrides({ a: 1 }, { b: 1 }), false);
});

const fakeAdmin = (state = {}) => { const calls = []; return { calls, configured: true,
    getLimits: async (a) => { calls.push(['get', a]); if (state.getErr) throw state.getErr; return { defaults: DEFAULTS, overrides: state.overrides || {} }; },
    setLimits: async (a, o) => { calls.push(['set', a, o]); if (state.setErr) throw state.setErr; } }; };
const quiet = () => { const l = []; return { l, log: (m) => l.push(m) }; };

test('applyTierLimits sets the tier overrides once, then reports unchanged, and clears them on a downgrade', async () => {
    const a = fakeAdmin(); assert.equal(await applyTierLimits(a, 'my-app', 'pro', quiet().log), 'applied');
    assert.deepEqual(a.calls[1], ['set', 'my-app', overridesForTier('pro', DEFAULTS)]);
    const b = fakeAdmin({ overrides: overridesForTier('pro', DEFAULTS) }); assert.equal(await applyTierLimits(b, 'my-app', 'pro', quiet().log), 'unchanged'); assert.equal(b.calls.length, 1);
    const c = fakeAdmin({ overrides: overridesForTier('pro', DEFAULTS) }); assert.equal(await applyTierLimits(c, 'my-app', 'free', quiet().log), 'applied'); assert.deepEqual(c.calls[1], ['set', 'my-app', {}]);
    const d = fakeAdmin({ overrides: {} }); assert.equal(await applyTierLimits(d, 'my-app', 'free', quiet().log), 'unchanged');
});

test('applyTierLimits never throws: unknown app is skipped, other errors are failed and logged by code only, bad input is skipped', async () => {
    const q = quiet();
    assert.equal(await applyTierLimits(fakeAdmin({ getErr: Object.assign(new Error('x'), { code: 'unknown_app' }) }), 'my-app', 'pro', q.log), 'skipped');
    assert.equal(await applyTierLimits(fakeAdmin({ setErr: Object.assign(new Error('secret detail'), { code: 'invalid_limits' }) }), 'my-app', 'pro', q.log), 'failed');
    assert.equal(q.l.length, 1); assert.match(q.l[0], /my-app/); assert.match(q.l[0], /invalid_limits/); assert.equal(q.l[0].includes('secret detail'), false);
    for (const sub of ['../x', 'A', 'x', undefined, 42]) assert.equal(await applyTierLimits(fakeAdmin(), sub, 'pro', q.log), 'skipped');
    assert.equal(await applyTierLimits({ configured: false }, 'my-app', 'pro', q.log), 'skipped'); assert.equal(await applyTierLimits(undefined, 'my-app', 'pro', q.log), 'skipped');
});

const seenEq = [];
const fakeDb = (deployments, subs = []) => ({ from: (t) => { const q = { f: [] }; const b = { select: () => b, eq: (...a) => { seenEq.push([t, ...a]); q.f.push(['eq', ...a]); return b; }, in: (...a) => { q.f.push(['in', ...a]); return b; },
    then: (res) => Promise.resolve(t === 'deployments' ? { data: deployments, error: null, f: q.f } : { data: subs, error: null }).then(res) }; return b; } });

test('syncTierLimitsForUser applies the user\'s current effective tier to each of their published apps', async () => {
    const a = fakeAdmin(); const r = await syncTierLimitsForUser({ supabase: fakeDb([{ subdomain: 'app-one' }, { subdomain: 'app-two' }]), proxyAdmin: a, userId: 'u1', getStatus: async () => ({ tier: 'team' }), log: quiet().log });
    assert.deepEqual(seenEq.filter((e) => e[0] === 'deployments'), [['deployments', 'user_id', 'u1'], ['deployments', 'status', 'active']]); // only this user's live deployments
    assert.equal(r.applied, 2); assert.deepEqual(a.calls.filter((c) => c[0] === 'set').map((c) => c[1]), ['app-one', 'app-two']); assert.equal(a.calls.find((c) => c[0] === 'set')[2].rowCap, 400000);
});

test('syncTierLimitsForUser tolerates a failing lookup and unusable input', async () => {
    const q = quiet(); const a = fakeAdmin();
    assert.deepEqual(await syncTierLimitsForUser({ supabase: fakeDb([]), proxyAdmin: a, userId: 'u1', getStatus: async () => { throw Object.assign(new Error('x'), { code: 'E' }); }, log: q.log }), { applied: 0 }); assert.match(q.l[0], /user sync failed/);
    for (const u of [undefined, '', 5]) assert.deepEqual(await syncTierLimitsForUser({ supabase: fakeDb([]), proxyAdmin: a, userId: u, getStatus: async () => ({ tier: 'pro' }) }), { applied: 0 });
    assert.deepEqual(await syncTierLimitsForUser({ supabase: fakeDb([{ subdomain: 'app-one' }]), proxyAdmin: { configured: false }, userId: 'u1', getStatus: async () => ({ tier: 'pro' }) }), { applied: 0 });
    assert.equal(a.calls.length, 0);
});

test('the sweep re-applies every paid user (so expiries and downgrades are corrected), can be triggered early but not more than once a minute', async () => {
    let t = 1_000_000; const q = quiet(); const a = fakeAdmin(); const asked = [];
    const db = { from: (tbl) => { const b = { select: () => b, in: (c, v) => { asked.push([c, v]); return b; }, eq: () => b, then: (res) => Promise.resolve(tbl === 'user_subscriptions' ? { data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null } : { data: [{ subdomain: 'app-one' }], error: null }).then(res) }; return b; } };
    const s = startTierSweep({ supabase: db, proxyAdmin: a, getStatus: async (u) => ({ tier: u === 'u1' ? 'pro' : 'free' }), intervalMs: 0, log: q.log, now: () => t, minGapMs: 60_000 });
    await s.runOnce(); assert.deepEqual(asked[0], ['tier', ['pro', 'team']]);
    assert.equal(a.calls.filter((c) => c[0] === 'get').length, 2); assert.equal(a.calls.filter((c) => c[0] === 'set').length, 1); // u2 is free with no overrides: unchanged
    assert.equal(s.trigger(), null); t += 30_000; assert.equal(s.trigger(), null); t += 31_000; const p = s.trigger(); assert.ok(p); await p; assert.equal(a.calls.filter((c) => c[0] === 'get').length, 4);
    s.stop();
});

test('a failing subscriptions query is logged by code and the sweep survives', async () => {
    const q = quiet(); const db = { from: () => { const b = { select: () => b, in: () => b, then: (res) => Promise.resolve({ data: null, error: { code: 'XX000' } }).then(res) }; return b; } };
    const s = startTierSweep({ supabase: db, proxyAdmin: fakeAdmin(), getStatus: async () => ({ tier: 'pro' }), intervalMs: 0, log: q.log }); await s.runOnce();
    assert.match(q.l[0], /sweep failed code=XX000/); s.stop();
});
