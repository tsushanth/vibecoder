import './../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');
const svc = await import('../../services/subscriptionService.js');
const { checkUsageLimit, recordUsage, getSubscriptionStatus, SUBSCRIPTION_TIERS, ACTION_TYPES } = svc;

const quiet = () => { const o = console.log, e = console.error; console.log = console.error = () => {}; return () => { console.log = o; console.error = e; }; };

function withDb({ sub = null, subError = null, usage = [], usageError = null }, fn) {
    return async () => {
        const restoreLog = quiet();
        const inserts = [];
        const restore = stubSupabase(supabase, (q) => {
            if (q.table === 'user_subscriptions') return { data: sub, error: subError };
            if (q.table === 'subscription_usage') {
                if (q.op === 'insert') { inserts.push(q.payload); return { data: { id: 'u1' }, error: null }; }
                return { data: usage, error: usageError };
            }
        });
        try { await fn({ inserts }); } finally { restore(); restoreLog(); }
    };
}
const noSub = { code: 'PGRST116', message: 'no rows' };
const rows = (n) => Array.from({ length: n }, () => ({ count: 1 }));

test('tier table: free 10/day + 3 tweaks; pro/team Infinity', () => {
    assert.equal(SUBSCRIPTION_TIERS.free.dailyGenerations, 10);
    assert.equal(SUBSCRIPTION_TIERS.free.tweaksPerProject, 3);
    for (const t of ['pro', 'team']) {
        assert.equal(SUBSCRIPTION_TIERS[t].dailyGenerations, Infinity);
        assert.equal(SUBSCRIPTION_TIERS[t].tweaksPerProject, Infinity);
        assert.equal(SUBSCRIPTION_TIERS[t].canCreatePrivateProjects, true);
    }
    assert.equal(SUBSCRIPTION_TIERS.free.canCreatePrivateProjects, false);
});

test('missing args are rejected', async () => {
    assert.equal((await checkUsageLimit(null, 'generation')).allowed, false);
    assert.equal((await checkUsageLimit('u', null)).allowed, false);
});

test('free: generation allowed at 9, blocked at 10, remaining computed', withDb({ subError: noSub, usage: rows(9) }, async () => {
    const r = await checkUsageLimit('u1', ACTION_TYPES.generation);
    assert.deepEqual([r.allowed, r.used, r.limit, r.remaining], [true, 9, 10, 1]);
}));
test('free: generation blocked at 10', withDb({ subError: noSub, usage: rows(10) }, async () => {
    const r = await checkUsageLimit('u1', ACTION_TYPES.generation);
    assert.equal(r.allowed, false);
    assert.equal(r.remaining, 0);
    assert.equal(r.requiresTier, 'pro');
    assert.match(r.error, /10 generations per day/);
}));
test('free: generation blocked above 10 too', withDb({ subError: noSub, usage: rows(25) }, async () => {
    assert.equal((await checkUsageLimit('u1', 'generation')).allowed, false);
}));

test('free: tweak limit 3 per project', async () => {
    await withDb({ subError: noSub, usage: rows(2) }, async () => {
        const r = await checkUsageLimit('u1', 'tweak', 'p1');
        assert.deepEqual([r.allowed, r.used, r.limit, r.remaining], [true, 2, 3, 1]);
    })();
    await withDb({ subError: noSub, usage: rows(3) }, async () => {
        const r = await checkUsageLimit('u1', 'tweak', 'p1');
        assert.equal(r.allowed, false);
        assert.match(r.error, /3 tweaks per project/);
    })();
});

test('free: tweak requires projectId', withDb({ subError: noSub }, async () => {
    const r = await checkUsageLimit('u1', 'tweak');
    assert.equal(r.allowed, false);
    assert.match(r.error, /projectId/);
}));

test('tweak usage query is scoped to user, action and project', async () => {
    const seen = [];
    const restoreLog = quiet();
    const restore = stubSupabase(supabase, (q) => {
        if (q.table === 'user_subscriptions') return { data: null, error: noSub };
        seen.push([eqOf(q, 'user_id'), eqOf(q, 'action_type'), eqOf(q, 'project_id')]);
        return { data: [], error: null };
    });
    try { await checkUsageLimit('u9', 'tweak', 'pX'); } finally { restore(); restoreLog(); }
    assert.deepEqual(seen, [['u9', 'tweak', 'pX']]);
});

test('pro: unlimited, never queries usage; Infinity not leaked into decision', withDb({
    sub: { tier: 'pro', status: 'active', expires_at: null, platform: 'ios' },
    usageError: { message: 'must not be queried' },
}, async () => {
    for (const a of ['generation', 'tweak', 'fork']) {
        const r = await checkUsageLimit('u1', a, 'p1');
        assert.equal(r.allowed, true); assert.equal(r.unlimited, true);
    }
}));

test('team: unlimited + can create private', withDb({ sub: { tier: 'team', status: 'active', expires_at: null } }, async () => {
    assert.equal((await checkUsageLimit('u1', 'generation')).unlimited, true);
    assert.equal((await checkUsageLimit('u1', 'create_private')).allowed, true);
}));

test('free: private project blocked with requiresTier', withDb({ subError: noSub }, async () => {
    const r = await checkUsageLimit('u1', 'create_private');
    assert.equal(r.allowed, false); assert.equal(r.requiresTier, 'pro');
}));

test('free: fork allowed', withDb({ subError: noSub }, async () => assert.equal((await checkUsageLimit('u1', 'fork')).allowed, true)));
test('unknown action rejected', withDb({ subError: noSub }, async () => assert.equal((await checkUsageLimit('u1', 'bogus')).allowed, false)));

test('expired pro falls back to free; inactive pro falls back to free', async () => {
    await withDb({ sub: { tier: 'pro', status: 'active', expires_at: '2000-01-01T00:00:00Z' }, usage: rows(10) }, async () => {
        const s = await getSubscriptionStatus('u1');
        assert.equal(s.tier, 'free'); assert.equal(s.status, 'expired'); assert.equal(s.originalTier, 'pro');
        assert.equal((await checkUsageLimit('u1', 'generation')).allowed, false);
    })();
    await withDb({ sub: { tier: 'pro', status: 'cancelled', expires_at: null } }, async () => {
        assert.equal((await getSubscriptionStatus('u1')).tier, 'free');
    })();
    await withDb({ sub: { tier: 'pro', status: 'active', expires_at: new Date(Date.now() + 86400e3).toISOString() } }, async () => {
        assert.equal((await getSubscriptionStatus('u1')).tier, 'pro');
    })();
});

test('unknown tier value in DB maps to free limits', withDb({ sub: { tier: 'enterprise', status: 'active', expires_at: null } }, async () => {
    const s = await getSubscriptionStatus('u1');
    assert.equal(s.limits.dailyGenerations, 10);
}));

test('fail-open on usage query error (documented behaviour)', withDb({ subError: noSub, usageError: { message: 'db down' } }, async () => {
    const r = await checkUsageLimit('u1', 'generation');
    assert.equal(r.allowed, true); assert.equal(r.limit, 10);
}));

test('subscription lookup error defaults to free', withDb({ subError: { code: 'XX', message: 'boom' }, usage: rows(0) }, async () => {
    assert.equal((await getSubscriptionStatus('u1')).tier, 'free');
}));

test('demo-user: free tier, no DB usage', async () => {
    const restoreLog = quiet();
    const restore = stubSupabase(supabase, () => { throw new Error('DB must not be touched'); });
    try {
        assert.equal((await checkUsageLimit('demo-user', 'generation')).limit, 10);
        assert.equal((await recordUsage('demo-user', 'generation')).usageId, 'demo-usage-id');
    } finally { restore(); restoreLog(); }
});

test('recordUsage inserts a row; DB error does not fail the request', async () => {
    await withDb({}, async ({ inserts }) => {
        const r = await recordUsage('u1', 'tweak', 'p1');
        assert.equal(r.success, true);
        assert.equal(inserts[0].user_id, 'u1'); assert.equal(inserts[0].project_id, 'p1');
    })();
    const restoreLog = quiet();
    const restore = stubSupabase(supabase, () => ({ data: null, error: { message: 'x' } }));
    try { assert.equal((await recordUsage('u1', 'generation')).usageId, 'error-fallback-id'); } finally { restore(); restoreLog(); }
    assert.equal((await recordUsage(null, 'x')).success, false);
});

test('Infinity serialises to null in JSON (the GET status route returns raw limits)', () => {
    // Documents a client-facing gotcha: /api/subscriptions/status returns `limits: result.limits`.
    assert.equal(JSON.parse(JSON.stringify(SUBSCRIPTION_TIERS.pro)).dailyGenerations, null);
});
