import '../helpers/env.mjs';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_for_signature_helper';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_value';
delete process.env.STRIPE_PRO_PRICE_ID; delete process.env.STRIPE_TEAM_PRICE_ID;
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Stripe from 'stripe';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
import { createMemDb } from '../helpers/memDb.mjs';
import { _setSink } from '../../lib/failureReporter.js';
const { supabase } = await import('../../config/database.js');
const { default: subscriptions } = await import('../../routes/subscriptions.routes.js');
const { _resetBillingEventsState } = await import('../../services/billingEvents.js');
const { createStripeEventProcessor } = await import('../../services/stripeWebhook.js');
const { getSubscriptionStatus } = await import('../../services/subscriptionService.js');
const { PAST_DUE_GRACE_MS } = await import('../../lib/entitlementState.js');

const USER = '3f2b8c1e-5a47-4d0b-9c1e-0a1b2c3d4e5f';
const SUB = 'sub_web_1';
const DAY = 86_400_000;
const sec = (ms) => Math.floor(ms / 1000);
let mem; const sent = []; _setSink((r) => sent.push(r));
let srv;
before(async () => { const app = express(); app.use('/api/subscriptions', subscriptions); srv = await listen(app); });
after(() => srv.close());
beforeEach(() => { mem = createMemDb(); stubSupabase(supabase, mem.handler); sent.length = 0; _resetBillingEventsState(); });
const settle = () => new Promise((r) => setTimeout(r, 30));
const row = () => mem.subs.get(USER);

let seq = 0;
const evt = (type, object, created = Date.now()) => ({ id: `evt_${++seq}`, object: 'event', type, created: sec(created), data: { object } });
const post = (event) => {
    const payload = JSON.stringify(event);
    const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const e = console.error; console.error = () => {};
    return fetch(`${srv.base}/api/subscriptions/stripe-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: payload }).finally(() => { console.error = e; });
};
const sub = (status, o = {}) => ({ id: SUB, object: 'subscription', status, customer: 'cus_1', metadata: { userId: USER, tier: 'pro' }, current_period_end: sec(Date.now() + 30 * DAY), ...o });
const checkout = () => evt('checkout.session.completed', { id: 'cs_1', mode: 'subscription', client_reference_id: USER, metadata: { tier: 'pro' }, subscription: SUB });

test('checkout creates a web pro row', async () => {
    assert.equal((await post(checkout())).status, 200);
    assert.deepEqual([row().tier, row().status, row().platform, row().product_id], ['pro', 'active', 'web', SUB]);
});

test('checkout without a user id is skipped LOUDLY (reported), answered 2xx, nothing written', async () => {
    const r = await post(evt('checkout.session.completed', { id: 'cs_2', mode: 'subscription', metadata: {}, subscription: SUB })); await settle();
    assert.equal(r.status, 200); assert.equal(mem.writes.length, 0);
    assert.deepEqual(sent.map((s) => [s.flow, s.message, s.context.reason]), [['billing:stripe_webhook_skipped', 'Stripe event skipped: checkout_without_user', 'checkout_without_user']]);
});

test('processing failure -> 5xx (Stripe retries) and one report; the retry then succeeds', async () => {
    mem.failWrites = true; const e = checkout();
    assert.equal((await post(e)).status, 500); await settle();
    assert.deepEqual(sent.map((s) => s.flow), ['billing:stripe_webhook_processing']);
    mem.failWrites = false; assert.equal((await post(e)).status, 200); assert.equal(row().tier, 'pro');
});

test('unknown event types and duplicates are 2xx; a duplicate is not applied twice', async () => {
    const r = await post(evt('customer.created', { id: 'cus_1' })); await settle();
    assert.equal(r.status, 200); assert.equal(sent[0].context.reason, 'unhandled_type');
    const e = checkout(); await post(e); const n = mem.writes.length; const d = await post(e);
    assert.equal(d.status, 200); assert.equal(mem.writes.length, n);
});

test('trialing keeps pro; the row expires at the period end and the read path honours it', async () => {
    await post(checkout());
    await post(evt('customer.subscription.updated', sub('trialing')));
    assert.equal(row().tier, 'pro'); assert.equal(row().status, 'active');
    assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
    await post(evt('customer.subscription.updated', sub('active', { current_period_end: sec(Date.now() - DAY) })));
    assert.equal((await getSubscriptionStatus(USER)).tier, 'free');
});

test('past_due keeps pro for the bounded grace window, repeats do not extend it, then access ends', async () => {
    await post(checkout());
    const t0 = Date.now();
    await post(evt('customer.subscription.updated', sub('past_due', { current_period_end: sec(t0 - 1000) }), t0));
    assert.equal(row().status, 'past_due'); assert.equal(row().tier, 'pro');
    const exp1 = new Date(row().expires_at).getTime();
    assert.ok(Math.abs(exp1 - (sec(t0) * 1000 + PAST_DUE_GRACE_MS)) < 2000);
    assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
    await post(evt('invoice.payment_failed', { id: 'in_1', subscription: SUB }, t0 + 2 * DAY));
    assert.equal(new Date(row().expires_at).getTime(), exp1);
    mem.subs.set(USER, { ...row(), expires_at: new Date(Date.now() - 1000).toISOString() }); // the window has passed
    assert.equal((await getSubscriptionStatus(USER)).tier, 'free');
});

test('recovery restores the paid tier (previously status came back but tier stayed free)', async () => {
    await post(checkout()); const t = Date.now();
    await post(evt('customer.subscription.updated', sub('unpaid'), t));
    assert.deepEqual([row().tier, row().status], ['free', 'cancelled']);
    await post(evt('customer.subscription.updated', sub('active'), t + 1000));
    assert.deepEqual([row().tier, row().status], ['pro', 'active']);
    assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
});

test('canceled, deleted, unpaid and incomplete_expired drop to free; the team tier survives past_due and recovery', async () => {
    for (const [type, status] of [['customer.subscription.updated', 'canceled'], ['customer.subscription.deleted', 'canceled'], ['customer.subscription.updated', 'unpaid'], ['customer.subscription.updated', 'incomplete_expired']]) {
        await post(checkout()); await post(evt(type, sub(status)));
        assert.deepEqual([row().tier, row().status], ['free', 'cancelled'], `${type} ${status}`);
    }
    await post(evt('customer.subscription.updated', sub('active', { metadata: { userId: USER, tier: 'team' } })));
    await post(evt('customer.subscription.updated', sub('past_due', { metadata: { userId: USER, tier: 'team' } })));
    assert.equal(row().tier, 'team');
});

test('a subscription event with no row is rebuilt from subscription metadata (out-of-order delivery), no longer ignored', async () => {
    const r = await post(evt('customer.subscription.updated', sub('active'))); assert.equal(r.status, 200);
    assert.deepEqual([row().tier, row().status, row().platform, row().product_id], ['pro', 'active', 'web', SUB]);
});

test('no row and no way to find the user: reported (updated/deleted), quiet for created; a deletion with no row is quiet', async () => {
    const noUser = sub('active', { metadata: {}, customer: null });
    await post(evt('customer.subscription.created', noUser)); await settle(); assert.equal(sent.length, 0);
    await post(evt('customer.subscription.updated', noUser)); await settle();
    assert.deepEqual(sent.map((s) => s.context.reason), ['subscription_without_user']);
    sent.length = 0; await post(evt('customer.subscription.deleted', sub('canceled'))); await settle();
    assert.equal(mem.writes.length, 0); assert.equal(sent.length, 0);
});

test('out of order: an older subscription event arriving after a newer one is ignored', async () => {
    await post(checkout()); const t = Date.now();
    await post(evt('customer.subscription.updated', sub('canceled'), t));
    const r = await post(evt('customer.subscription.updated', sub('active'), t - 60_000));
    assert.equal(r.status, 200); assert.deepEqual([row().tier, row().status], ['free', 'cancelled']);
});

test('an old subscription id (replaced by a new checkout) cannot take away the newer subscription', async () => {
    await post(checkout());
    mem.subs.set(USER, { ...row(), product_id: 'sub_new' });
    await post(evt('customer.subscription.deleted', sub('canceled', { id: SUB })));
    assert.equal(row().tier, 'pro'); assert.equal(row().product_id, 'sub_new');
    await post(evt('customer.subscription.updated', sub('active', { id: SUB }))); // old sub, active: must not replace the live one
    assert.equal(row().product_id, 'sub_new');
});

test('a web subscription event does not overwrite an active mobile entitlement', async () => {
    mem.subs.set(USER, { user_id: USER, tier: 'pro', status: 'active', platform: 'android', product_id: 'p', expires_at: new Date(Date.now() + DAY).toISOString() });
    await post(evt('customer.subscription.created', sub('active'))); await settle();
    assert.equal(row().platform, 'android');
    assert.deepEqual(sent.map((s) => s.context.reason), ['other_active_source']);
});

test('invoice.paid ends past_due; invoice.payment_failed starts it; neither revives a cancelled row; new-API invoice shape works', async () => {
    await post(checkout()); const t = Date.now();
    await post(evt('invoice.payment_failed', { id: 'in_1', subscription: SUB }, t));
    assert.equal(row().status, 'past_due');
    const end = t + 31 * DAY;
    await post(evt('invoice.paid', { id: 'in_2', parent: { subscription_details: { subscription: SUB } }, lines: { data: [{ period: { end: sec(end) } }] } }, t + 1000));
    assert.equal(row().status, 'active'); assert.equal(new Date(row().expires_at).getTime(), sec(end) * 1000);
    await post(evt('customer.subscription.deleted', sub('canceled'), t + 2000));
    await post(evt('invoice.paid', { id: 'in_3', subscription: SUB, lines: { data: [] } }, t + 3000)); await settle();
    assert.equal(row().tier, 'free');
});

test('period end is read from items on newer Stripe API versions', async () => {
    await post(checkout()); const end = Date.now() + 12 * DAY;
    const s = sub('active'); delete s.current_period_end; s.items = { data: [{ current_period_end: sec(end) }] };
    await post(evt('customer.subscription.updated', s));
    assert.equal(new Date(row().expires_at).getTime(), sec(end) * 1000);
});

// ---- refund / dispute handlers need the Stripe API for the subscription: tested on the processor with a fake API ----
const proc = (api) => createStripeEventProcessor({ supabase, api });
const fakeApi = (o = {}) => ({ customerUserId: async () => null, subscriptionIdForCharge: async () => SUB, getSubscription: async () => sub('active'), ...o });
const seed = () => mem.subs.set(USER, { user_id: USER, tier: 'pro', status: 'active', platform: 'web', product_id: SUB, expires_at: new Date(Date.now() + 20 * DAY).toISOString() });

test('full refund revokes access now; partial refund changes nothing and is reported', async () => {
    seed(); const p = proc(fakeApi());
    await p.process(evt('charge.refunded', { id: 'ch_1', amount: 999, amount_refunded: 500, refunded: false })); await settle();
    assert.equal(row().tier, 'pro'); assert.equal(sent[0].context.reason, 'partial_refund');
    await p.process(evt('charge.refunded', { id: 'ch_1', amount: 999, amount_refunded: 999, refunded: true }));
    assert.deepEqual([row().tier, row().status], ['free', 'refunded']); assert.equal((await getSubscriptionStatus(USER)).tier, 'free');
});

test('dispute opened revokes; dispute won restores from the live subscription; dispute lost stays revoked', async () => {
    seed(); const p = proc(fakeApi());
    await p.process(evt('charge.dispute.created', { id: 'dp_1', charge: 'ch_1' }));
    assert.deepEqual([row().tier, row().status], ['free', 'disputed']);
    await p.process(evt('charge.dispute.closed', { id: 'dp_1', charge: 'ch_1', status: 'lost' }, Date.now() + 1000));
    assert.equal(row().tier, 'free');
    await p.process(evt('charge.dispute.closed', { id: 'dp_1', charge: 'ch_1', status: 'won' }, Date.now() + 2000));
    assert.deepEqual([row().tier, row().status], ['pro', 'active']);
});

test('dispute won but the subscription is already cancelled: stays free', async () => {
    seed(); const p = proc(fakeApi({ getSubscription: async () => sub('canceled') }));
    await p.process(evt('charge.dispute.created', { id: 'dp_2', charge: 'ch_1' }));
    await p.process(evt('charge.dispute.closed', { id: 'dp_2', charge: 'ch_1', status: 'won' }, Date.now() + 1000));
    assert.equal(row().tier, 'free');
});

test('charge events whose subscription cannot be found are skipped with a report; Stripe API trouble throws for a retry', async () => {
    seed();
    await proc(fakeApi({ subscriptionIdForCharge: async () => null })).process(evt('charge.refunded', { id: 'ch_9', amount: 5, amount_refunded: 5, refunded: true })); await settle();
    assert.equal(row().tier, 'pro'); assert.equal(sent[0].context.reason, 'charge_without_subscription');
    await assert.rejects(proc(fakeApi({ subscriptionIdForCharge: async () => { throw new Error('stripe down'); } })).process(evt('charge.dispute.created', { id: 'dp_3', charge: 'ch_9' })));
});

test('a missing row is rebuilt from the Stripe customer metadata when the subscription carries none', async () => {
    const p = proc(fakeApi({ customerUserId: async (c) => (c === 'cus_1' ? USER : null) }));
    await p.process(evt('customer.subscription.updated', sub('active', { metadata: {} })));
    assert.deepEqual([row().tier, row().product_id], ['pro', SUB]);
});

test('before the event-log migration is applied the Stripe webhook still works and reports the missing table once', async () => {
    mem.eventsTable = false;
    await post(checkout()); await post(evt('customer.subscription.updated', sub('active'))); await settle();
    assert.equal(row().tier, 'pro'); assert.deepEqual(sent.map((s) => s.flow), ['billing:event_log_unavailable']);
});

test('a skipped event does not make the checkout event look stale (subscription.created before checkout, no metadata)', async () => {
    const t = Date.now();
    await post(evt('customer.subscription.created', sub('active', { metadata: {}, customer: null }), t + 2000));
    await post(evt('checkout.session.completed', { id: 'cs_9', mode: 'subscription', client_reference_id: USER, metadata: { tier: 'pro' }, subscription: SUB }, t + 1000));
    assert.equal(row().tier, 'pro');
});

test('a cancellation seen before its checkout wins: the late checkout does not resurrect the subscription', async () => {
    const t = Date.now();
    await post(evt('customer.subscription.deleted', sub('canceled'), t + 2000));
    await post(evt('checkout.session.completed', { id: 'cs_9', mode: 'subscription', client_reference_id: USER, metadata: { tier: 'pro' }, subscription: SUB }, t + 1000));
    assert.equal(row(), undefined);
});
