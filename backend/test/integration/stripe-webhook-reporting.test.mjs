import '../helpers/env.mjs';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_for_signature_helper';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_value';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Stripe from 'stripe';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
import { _setSink } from '../../lib/failureReporter.js';
const { supabase } = await import('../../config/database.js');
const { default: subscriptions } = await import('../../routes/subscriptions.routes.js');

// A paid Stripe event that could not be applied used to be answered 200 (Stripe never retries) with only a console line.
let dbError = null; const sent = []; _setSink((r) => sent.push(r));
stubSupabase(supabase, () => ({ data: null, error: dbError }));
let srv;
before(async () => { const app = express(); app.use('/api/subscriptions', subscriptions); srv = await listen(app); });
after(() => srv.close());
const post = (payload, sig) => { const e = console.error; console.error = () => {}; return fetch(`${srv.base}/api/subscriptions/stripe-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: payload }).finally(() => { console.error = e; }); };
const signed = (obj) => { const payload = JSON.stringify(obj); return [payload, Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })]; };
const checkout = { id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: { id: 'cs_1', client_reference_id: 'user-secret-id-1', metadata: { tier: 'pro' }, subscription: 'sub_1' } } };

test('bad signature -> 400 and one stripe_webhook_signature failure', async () => {
    sent.length = 0; const res = await post('{}', 't=1,v1=bad'); await new Promise((r) => setTimeout(r, 30));
    assert.equal(res.status, 400); assert.deepEqual(sent.map((s) => [s.kind, s.flow]), [['failure', 'billing:stripe_webhook_signature']]);
});

// Was answered 200 (Stripe never retried); now 5xx so Stripe retries the event. The report is unchanged.
test('a database error while applying a paid checkout answers 5xx for a Stripe retry and is reported (event type only, no user id)', async () => {
    sent.length = 0; dbError = { code: '57P01', message: 'terminating connection' };
    const res = await post(...signed(checkout)); await new Promise((r) => setTimeout(r, 30));
    assert.equal(res.status, 500);
    assert.deepEqual(sent.map((s) => [s.flow, s.message, s.context]), [['billing:stripe_webhook_processing', 'Stripe webhook processing failed', { event_type: 'checkout.session.completed' }]]);
    assert.equal(JSON.stringify(sent).includes('user-secret-id'), false);
});

test('a healthy checkout reports nothing', async () => {
    sent.length = 0; dbError = null;
    const res = await post(...signed(checkout)); await new Promise((r) => setTimeout(r, 30));
    assert.equal(res.status, 200); assert.equal(sent.length, 0);
});
