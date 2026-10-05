import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

const queries = [];
stubSupabase(supabase, (q) => { queries.push({ table: q.table, op: q.op, payload: q.payload }); return { data: null, error: { code: 'PGRST116' } }; });
const { default: router } = await import('../../routes/subscriptions.routes.js');

let srv;
before(async () => { const app = express(); app.use(express.json()); app.use('/api/subscriptions', router); srv = await listen(app); });
after(() => srv.close());
const post = (body) => fetch(`${srv.base}/api/subscriptions/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const writes = () => queries.filter((q) => q.op !== 'select');

test('a made-up iOS or Android receipt for any user is refused with 501 and nothing is written or read', async () => {
    queries.length = 0;
    for (const [platform, receiptData] of [['ios', 'com.vibecoder.pro.monthly_fake'], ['android', 'com.vibecoder.team.monthly_x'], ['ios', 'pro_anything'], ['android', 'team_whatever']]) {
        const r = await post({ userId: 'any-victim-id', platform, receiptData });
        assert.equal(r.status, 501, `${platform} ${receiptData}`);
        const j = await r.json(); assert.equal(typeof j.error, 'string'); assert.equal(j.success, undefined); assert.equal(j.tier, undefined);
    }
    assert.deepEqual(queries, [], 'the refusal must not touch the database at all');
});

test('input validation still answers first: missing fields and bad platforms are 400', async () => {
    assert.equal((await post({ platform: 'ios', receiptData: 'x' })).status, 400);
    assert.equal((await post({ userId: 'u', receiptData: 'x' })).status, 400);
    assert.equal((await post({ userId: 'u', platform: 'ios' })).status, 400);
    assert.equal((await post({ userId: 'u', platform: 'web', receiptData: 'x' })).status, 400);
});

test('there is no path through the service that grants a tier from a receipt string', async () => {
    const { verifyReceipt } = await import('../../services/subscriptionService.js');
    queries.length = 0;
    const out = await verifyReceipt('ios', 'com.vibecoder.pro.monthly_receipt', 'someone');
    assert.equal(out.success, false); assert.equal(out.unavailable, true);
    assert.deepEqual(writes(), []);
});

test('the read-only plans and status routes still work', async () => {
    const plans = await fetch(`${srv.base}/api/subscriptions/plans`); assert.equal(plans.status, 200);
    const status = await fetch(`${srv.base}/api/subscriptions/status?userId=nobody`); assert.equal(status.status, 200);
    assert.equal((await status.json()).tier, 'free');
});
