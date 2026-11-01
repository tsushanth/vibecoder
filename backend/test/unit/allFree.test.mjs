import './../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
import { allFreeEnabled, fairUseConfig } from '../../lib/allFree.js';
import { _setSink } from '../../lib/failureReporter.js';
const { supabase } = await import('../../config/database.js');
const svc = await import('../../services/subscriptionService.js');
const fair = await import('../../services/fairUse.js');
const { checkUsageLimit, getSubscriptionStatus } = svc;

const quiet = () => { const o = [console.log, console.error]; console.log = console.error = () => {}; return () => { [console.log, console.error] = o; }; };
const noSub = { code: 'PGRST116', message: 'no rows' };
const rows = (n) => Array.from({ length: n }, () => ({ id: 'x' }));
const ENV_KEYS = ['VIBEBUILD_ALL_FREE', 'VIBEBUILD_FAIR_USE_DAILY_GENERATIONS', 'VIBEBUILD_FAIR_USE_TWEAKS_PER_PROJECT', 'VIBEBUILD_DAILY_BUILDS_ALERT_THRESHOLD'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function setEnv(env) { for (const k of ENV_KEYS) delete process.env[k]; Object.assign(process.env, env); }
test.afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } _setSink(null); fair._resetDailyAlertForTests(); });

function withDb({ sub = null, subError = null, usage = [], usageError = null, count = 0 }, fn) {
    return async () => {
        const restoreLog = quiet(); const seen = [];
        const restore = stubSupabase(supabase, (q) => {
            if (q.table === 'user_subscriptions') return { data: sub, error: subError };
            if (q.table === 'subscription_usage') {
                if (q.op === 'insert') return { data: { id: 'u1' }, error: null };
                seen.push(q);
                return { data: usage, error: usageError, count };
            }
        });
        try { await fn({ seen }); } finally { restore(); restoreLog(); }
    };
}

test('the switch: ON when unset, empty or any non-off word; OFF only for 0 / false / off / no', () => {
    assert.equal(allFreeEnabled({}), true);
    assert.equal(allFreeEnabled({ VIBEBUILD_ALL_FREE: '' }), true);
    assert.equal(allFreeEnabled({ VIBEBUILD_ALL_FREE: '1' }), true);
    assert.equal(allFreeEnabled({ VIBEBUILD_ALL_FREE: 'true' }), true);
    for (const v of ['0', 'false', 'OFF', ' no ']) assert.equal(allFreeEnabled({ VIBEBUILD_ALL_FREE: v }), false, v);
});

test('fair-use numbers: defaults 30 / 50 / 300, env overrides, junk falls back', () => {
    assert.deepEqual(fairUseConfig({}), { dailyGenerations: 30, tweaksPerProject: 50, dailyBuildsAlertThreshold: 300 });
    assert.deepEqual(fairUseConfig({ VIBEBUILD_FAIR_USE_DAILY_GENERATIONS: '12', VIBEBUILD_FAIR_USE_TWEAKS_PER_PROJECT: '7', VIBEBUILD_DAILY_BUILDS_ALERT_THRESHOLD: '99' }), { dailyGenerations: 12, tweaksPerProject: 7, dailyBuildsAlertThreshold: 99 });
    assert.equal(fairUseConfig({ VIBEBUILD_FAIR_USE_DAILY_GENERATIONS: 'abc' }).dailyGenerations, 30);
    assert.equal(fairUseConfig({ VIBEBUILD_FAIR_USE_DAILY_GENERATIONS: '-3' }).dailyGenerations, 30);
});

test('ON: a never-subscribed user resolves to full Pro; the stored plan is still reported as data', withDb({ subError: noSub }, async () => {
    setEnv({});
    const s = await getSubscriptionStatus('u1');
    assert.equal(s.success, true); assert.equal(s.tier, 'pro'); assert.equal(s.allFree, true); assert.equal(s.status, 'active');
    assert.equal(s.storedTier, 'free');
    assert.equal(s.limits.canCreatePrivateProjects, true);
    assert.equal(s.limits.dailyGenerations, 30); assert.equal(s.limits.tweaksPerProject, 50);
}));

test('ON: an expired pro row and a cancelled one both resolve to Pro; storedTier says what the row means', async () => {
    setEnv({});
    await withDb({ sub: { tier: 'pro', status: 'active', expires_at: '2000-01-01T00:00:00Z' } }, async () => {
        const s = await getSubscriptionStatus('u1');
        assert.equal(s.tier, 'pro'); assert.equal(s.storedTier, 'free'); assert.equal(s.storedStatus, 'expired'); assert.equal(s.originalTier, 'pro');
    })();
    await withDb({ sub: { tier: 'team', status: 'active', expires_at: null } }, async () => {
        const s = await getSubscriptionStatus('u1'); assert.equal(s.tier, 'pro'); assert.equal(s.storedTier, 'team');
    })();
});

test('ON: a failing subscription lookup still gives full access (nobody loses features on a read error)', withDb({ subError: { code: 'XX', message: 'boom' } }, async () => {
    setEnv({});
    const s = await getSubscriptionStatus('u1'); assert.equal(s.tier, 'pro'); assert.equal(s.allFree, true);
}));

test('ON: private projects need no plan (never-subscribed user)', withDb({ subError: noSub }, async () => {
    setEnv({});
    const r = await checkUsageLimit('u1', 'create_private');
    assert.equal(r.allowed, true); assert.equal(r.requiresTier, undefined);
}));

test('ON: tweaks are unlimited within fair use: allowed at 49 (was blocked at 3), refused at 50 with a fair-use result and no upgrade hint', async () => {
    setEnv({});
    await withDb({ subError: noSub, usage: rows(49) }, async () => {
        const r = await checkUsageLimit('u1', 'tweak', 'p1');
        assert.deepEqual([r.allowed, r.used, r.limit, r.remaining], [true, 49, 50, 1]);
    })();
    await withDb({ subError: noSub, usage: rows(3) }, async () => assert.equal((await checkUsageLimit('u1', 'tweak', 'p1')).allowed, true))();
    await withDb({ subError: noSub, usage: rows(50) }, async () => {
        const r = await checkUsageLimit('u1', 'tweak', 'p1');
        assert.equal(r.allowed, false); assert.equal(r.fairUse, true); assert.equal(r.scope, 'tweaks_per_project');
        assert.equal(r.requiresTier, undefined); assert.equal(r.currentTier, undefined);
        assert.match(r.error, /fair-use limit/i); assert.doesNotMatch(r.error, /\bpro\b|upgrade|subscri/i);
    })();
});

test('ON: daily generations: allowed at 29 (was blocked at 10), refused at 30; the limit follows the env', async () => {
    setEnv({});
    await withDb({ subError: noSub, usage: rows(29) }, async () => {
        const r = await checkUsageLimit('u1', 'generation');
        assert.deepEqual([r.allowed, r.used, r.limit, r.remaining], [true, 29, 30, 1]);
        assert.match(r.resetsAt, /T00:00:00\.000Z$/);
    })();
    await withDb({ subError: noSub, usage: rows(30) }, async () => {
        const r = await checkUsageLimit('u1', 'generation');
        assert.equal(r.allowed, false); assert.equal(r.fairUse, true); assert.equal(r.error, "You have reached today's fair-use limit, try again tomorrow."); assert.equal(r.remaining, 0);
    })();
    setEnv({ VIBEBUILD_FAIR_USE_DAILY_GENERATIONS: '5' });
    await withDb({ subError: noSub, usage: rows(5) }, async () => assert.equal((await checkUsageLimit('u1', 'generation')).allowed, false))();
    await withDb({ subError: noSub, usage: rows(4) }, async () => assert.equal((await checkUsageLimit('u1', 'generation')).allowed, true))();
});

test('ON: the generation count is scoped to the user, the action and the UTC day; the tweak count to the project', async () => {
    setEnv({});
    await withDb({ subError: noSub, usage: [] }, async ({ seen }) => {
        await checkUsageLimit('u9', 'generation'); await checkUsageLimit('u9', 'tweak', 'pX');
        assert.deepEqual([eqOf(seen[0], 'user_id'), eqOf(seen[0], 'action_type')], ['u9', 'generation']);
        const gte = seen[0].filters.find((f) => f[0] === 'gte' && f[1] === 'created_at');
        assert.ok(gte && /T00:00:00\.000Z$/.test(gte[2]), 'window starts at UTC midnight');
        assert.deepEqual([eqOf(seen[1], 'user_id'), eqOf(seen[1], 'action_type'), eqOf(seen[1], 'project_id')], ['u9', 'tweak', 'pX']);
    })();
});

test('ON: fail-open. A usage lookup error allows the action, is logged, and is reported once with a stable message (no user data)', async () => {
    setEnv({});
    const reports = []; _setSink((r) => reports.push(r));
    await withDb({ subError: noSub, usageError: { message: 'db down', code: 'XX' } }, async () => {
        const g = await checkUsageLimit('secret-user-id', 'generation');
        const t = await checkUsageLimit('secret-user-id', 'tweak', 'p1');
        assert.equal(g.allowed, true); assert.equal(t.allowed, true);
    })();
    assert.equal(reports.length, 2);
    assert.ok(reports.every((r) => r.message === 'Fair-use usage lookup failed; request allowed'));
    assert.ok(!JSON.stringify(reports).includes('secret-user-id'));
});

test('ON: a thrown error inside the fair-use check also allows the action', async () => {
    setEnv({});
    const restoreLog = quiet();
    const restore = stubSupabase(supabase, () => { throw new Error('stub exploded'); });
    try { assert.equal((await checkUsageLimit('u1', 'generation')).allowed, true); } finally { restore(); restoreLog(); }
});

test('OFF (VIBEBUILD_ALL_FREE=0) restores the old tiers: Free 10/day, 3 tweaks, no private projects; expired pro is free', async () => {
    setEnv({ VIBEBUILD_ALL_FREE: '0' });
    await withDb({ subError: noSub }, async () => {
        const s = await getSubscriptionStatus('u1');
        assert.equal(s.tier, 'free'); assert.equal(s.allFree, undefined); assert.equal(s.limits.dailyGenerations, 10); assert.equal(s.limits.tweaksPerProject, 3);
        const p = await checkUsageLimit('u1', 'create_private'); assert.equal(p.allowed, false); assert.equal(p.requiresTier, 'pro');
    })();
    await withDb({ subError: noSub, usage: [{ count: 1 }, { count: 1 }, { count: 1 }] }, async () => {
        const t = await checkUsageLimit('u1', 'tweak', 'p1'); assert.equal(t.allowed, false); assert.equal(t.requiresTier, 'pro'); assert.equal(t.fairUse, undefined);
    })();
    await withDb({ sub: { tier: 'pro', status: 'active', expires_at: '2000-01-01T00:00:00Z' } }, async () => assert.equal((await getSubscriptionStatus('u1')).tier, 'free'))();
    await withDb({ sub: { tier: 'pro', status: 'active', expires_at: null } }, async () => assert.equal((await getSubscriptionStatus('u1')).tier, 'pro'))();
});

test('daily-build safety net: over the threshold it reports counts once per day and never throws; at or under it stays quiet', async () => {
    setEnv({ VIBEBUILD_DAILY_BUILDS_ALERT_THRESHOLD: '300' });
    const reports = []; _setSink((r) => reports.push(r));
    await withDb({ count: 300 }, async () => assert.equal(await fair.reportIfDailyBuildsHigh(), false))();
    assert.equal(reports.length, 0);
    await withDb({ count: 301 }, async () => {
        assert.equal(await fair.reportIfDailyBuildsHigh(), true);
        assert.equal(await fair.reportIfDailyBuildsHigh(), false, 'once per UTC day per instance');
    })();
    assert.equal(reports.length, 1);
    assert.equal(reports[0].flow, 'capacity:daily_builds_over_threshold');
    assert.equal(reports[0].message, 'Daily VibeBuild builds passed the safety threshold');
    assert.deepEqual(reports[0].context, { builds_today: '301', threshold: '300' });
    fair._resetDailyAlertForTests();
    await withDb({ usageError: { message: 'x' } }, async () => assert.equal(await fair.reportIfDailyBuildsHigh(), false))();
});

test('fairUseSnapshot: used / limit / remaining / resetsAt for the status endpoint; a failed lookup shows 0 used', async () => {
    setEnv({});
    await withDb({ usage: rows(4) }, async () => {
        const s = await fair.fairUseSnapshot('u1');
        assert.deepEqual([s.dailyGenerations.used, s.dailyGenerations.limit, s.dailyGenerations.remaining], [4, 30, 26]);
        assert.match(s.dailyGenerations.resetsAt, /T00:00:00\.000Z$/); assert.equal(s.tweaksPerProject.limit, 50);
        const p = await fair.fairUseSnapshot('u1', 'pX'); assert.deepEqual([p.tweaksPerProject.used, p.tweaksPerProject.remaining], [4, 46]);
    })();
    await withDb({ usageError: { message: 'down' } }, async () => assert.equal((await fair.fairUseSnapshot('u1')).dailyGenerations.used, 0))();
});
