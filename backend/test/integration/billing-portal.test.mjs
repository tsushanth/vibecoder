import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');
const { createBillingPortalRouter } = await import('../../routes/billingPortal.routes.js');

// Opening the Stripe portal must only ever show the caller's own subscription, and must say plainly when there is nothing to manage.
let row = null; let dbError = null; const queries = [];
stubSupabase(supabase, (q) => { queries.push({ table: q.table, userId: eqOf(q, 'user_id') }); return dbError ? { data: null, error: dbError } : { data: row, error: null }; });

let verified = 'u1'; let subscription = { id: 'sub_1', customer: 'cus_1' }; let retrieveError = null; let createError = null;
const calls = { retrieve: [], portal: [] }; const logs = [];
const stripe = {
    subscriptions: { retrieve: async (id) => { calls.retrieve.push(id); if (retrieveError) throw retrieveError; return subscription; } },
    billingPortal: { sessions: { create: async (p) => { calls.portal.push(p); if (createError) throw createError; return { url: 'https://billing.stripe.com/p/session/test' }; } } },
};
let useStripe = true; let configurationId; let srv;
before(async () => {
    const app = express();
    app.use(express.json()); // so a body, if the route ever read one, would be seen
    app.use('/portal', (req, res, next) => createBillingPortalRouter({ stripe: useStripe ? stripe : null, verifyUser: async () => verified, returnUrl: 'https://vibebuild.cc/settings', configurationId, log: (m) => logs.push(m), maxPerMinute: 1000 })(req, res, next));
    srv = await listen(app);
});
after(() => srv.close());
const reset = () => { row = { platform: 'web', product_id: 'sub_1', status: 'active' }; dbError = null; verified = 'u1'; configurationId = undefined; subscription = { id: 'sub_1', customer: 'cus_1' }; retrieveError = null; createError = null; useStripe = true; queries.length = 0; calls.retrieve.length = 0; calls.portal.length = 0; logs.length = 0; };
const open = (body) => fetch(`${srv.base}/portal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

test('no verified user: 401, and neither the database nor Stripe is touched', async () => {
    reset(); verified = null;
    const r = await open({ userId: 'victim' });
    assert.equal(r.status, 401); assert.deepEqual(queries, []); assert.deepEqual(calls.retrieve, []);
});

test('a subscriber is sent to the portal of the customer on their own subscription, returning to Account', async () => {
    reset();
    const r = await open(); assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { url: 'https://billing.stripe.com/p/session/test' });
    assert.deepEqual(calls.retrieve, ['sub_1']);
    assert.deepEqual(calls.portal, [{ customer: 'cus_1', return_url: 'https://vibebuild.cc/settings' }]);
});

test('the lookup uses the verified id, never a userId in the request', async () => {
    reset(); verified = 'real-user';
    await open({ userId: 'someone-else', user_id: 'someone-else' });
    assert.deepEqual(queries.map((q) => q.userId), ['real-user']);
});

test('nothing to manage: no row, a plan bought in a store, or a stored id that is not a Stripe subscription, all 404 without calling Stripe', async () => {
    for (const r of [null, { platform: 'android', product_id: 'sub_looks_stripe', status: 'active' }, { platform: 'ios', product_id: 'com.vibecoder.pro.monthly', status: 'active' }, { platform: 'web', product_id: 'cs_test_session', status: 'active' }, { platform: 'web', product_id: null, status: 'active' }]) {
        reset(); row = r;
        const res = await open(); assert.equal(res.status, 404, JSON.stringify(r)); assert.equal((await res.json()).error, 'no_web_subscription');
        assert.deepEqual(calls.retrieve, []); assert.deepEqual(calls.portal, []);
    }
});

test('an expanded customer object and a missing customer are both handled', async () => {
    reset(); subscription = { id: 'sub_1', customer: { id: 'cus_obj' } };
    assert.equal((await open()).status, 200); assert.equal(calls.portal[0].customer, 'cus_obj');
    reset(); subscription = { id: 'sub_1', customer: null };
    assert.equal((await open()).status, 404); assert.deepEqual(calls.portal, []);
});

test('Stripe says the subscription is gone: 404; any other Stripe or database failure: 502 with a short code and nothing else', async () => {
    reset(); retrieveError = Object.assign(new Error('No such subscription: sub_1 for key rk_live_secretvalue'), { code: 'resource_missing' });
    assert.equal((await open()).status, 404);
    reset(); createError = Object.assign(new Error('boom with rk_live_secretvalue inside'), { type: 'StripeAPIError' });
    let r = await open(); assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: 'portal_unavailable' });
    assert.ok(logs.every((l) => !/secretvalue|boom/.test(l)), 'the log carries a code, never the error text'); assert.equal(logs.length, 1);
    reset(); dbError = { code: 'PGRST301', message: 'db down' };
    r = await open(); assert.equal(r.status, 502);
});

test('Stripe not configured: 503, and only for a signed-in caller', async () => {
    reset(); useStripe = false;
    assert.equal((await open()).status, 503);
    verified = null; assert.equal((await open()).status, 401);
});

test('uses the VibeBuild portal configuration when one is set, and Stripe\'s default otherwise', async () => {
    reset(); configurationId = 'bpc_vibebuild';
    assert.equal((await open()).status, 200); assert.equal(calls.portal[0].configuration, 'bpc_vibebuild');
    reset();
    assert.equal((await open()).status, 200); assert.equal('configuration' in calls.portal[0], false);
});
