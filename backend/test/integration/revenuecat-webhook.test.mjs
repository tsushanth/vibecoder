import '../helpers/env.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
import { createMemDb } from '../helpers/memDb.mjs';
import { _setSink } from '../../lib/failureReporter.js';
const { supabase } = await import('../../config/database.js');
const { default: rcRoutes, _resetRevenueCatRouteState } = await import('../../routes/revenuecat.routes.js');
const { default: subscriptionsRoutes } = await import('../../routes/subscriptions.routes.js');
const { _resetBillingEventsState } = await import('../../services/billingEvents.js');
const { _setRevenueCatFetch } = await import('../../services/revenueCat.js');
const { getSubscriptionStatus } = await import('../../services/subscriptionService.js');

const SECRET = 'rc-test-shared-secret-value';
const USER = '3f2b8c1e-5a47-4d0b-9c1e-0a1b2c3d4e5f';
const OTHER = '9b1c2d3e-4f50-4a6b-8c7d-1e2f3a4b5c6d';
const DAY = 86_400_000;
let mem; const sent = []; _setSink((r) => sent.push(r));
let srv;
before(async () => {
    const app = express(); app.use(express.json());
    app.use('/api/webhooks/revenuecat', rcRoutes);
    app.use('/api/subscriptions', subscriptionsRoutes);
    srv = await listen(app);
});
after(() => srv.close());
beforeEach(() => {
    mem = createMemDb(); stubSupabase(supabase, mem.handler);
    sent.length = 0; process.env.REVENUECAT_WEBHOOK_AUTH = SECRET; delete process.env.REVENUECAT_SECRET_API_KEY;
    _resetRevenueCatRouteState(); _resetBillingEventsState(); _setRevenueCatFetch(null);
});

let seq = 0;
const ev = (type, o = {}) => ({ api_version: '1.0', event: { id: `evt-${++seq}`, type, app_user_id: USER, store: 'PLAY_STORE', product_id: 'vibebuild_pro_monthly', entitlement_ids: ['pro'], event_timestamp_ms: Date.now(), expiration_at_ms: Date.now() + 30 * DAY, environment: 'PRODUCTION', ...o } });
const post = (body, auth = SECRET) => fetch(`${srv.base}/api/webhooks/revenuecat`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth === null ? {} : { authorization: auth }) }, body: JSON.stringify(body) });
const settle = () => new Promise((r) => setTimeout(r, 30));
const row = () => mem.subs.get(USER);

test('unset REVENUECAT_WEBHOOK_AUTH: every call is 503, nothing is written, one report only', async () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    for (let i = 0; i < 3; i++) assert.equal((await post(ev('INITIAL_PURCHASE'), 'anything')).status, 503);
    await settle();
    assert.equal(mem.writes.length, 0);
    assert.deepEqual(sent.map((s) => s.flow), ['billing:revenuecat_webhook_config']);
});

test('missing or wrong Authorization is 401 and writes nothing; the configured value works raw or with a Bearer prefix', async () => {
    assert.equal((await post(ev('INITIAL_PURCHASE'), null)).status, 401);
    assert.equal((await post(ev('INITIAL_PURCHASE'), 'wrong')).status, 401);
    assert.equal((await post(ev('INITIAL_PURCHASE'), SECRET + 'x')).status, 401);
    assert.equal(mem.writes.length, 0);
    assert.equal((await post(ev('INITIAL_PURCHASE'), `Bearer ${SECRET}`)).status, 200);
    assert.equal(mem.writes.length, 1);
});

test('malformed payload is 400', async () => {
    assert.equal((await post({ nope: 1 })).status, 400);
});

test('TEST event is acknowledged and writes no entitlement', async () => {
    const r = await post(ev('TEST', { app_user_id: 'anything' }));
    assert.equal(r.status, 200); assert.equal(mem.writes.length, 0); await settle(); assert.equal(sent.length, 0);
});

test('INITIAL_PURCHASE on Android makes the user pro on the server (the original bug), via the status route too', async () => {
    const exp = Date.now() + 30 * DAY;
    assert.equal((await post(ev('INITIAL_PURCHASE', { expiration_at_ms: exp }))).status, 200);
    assert.equal(row().platform, 'android'); assert.equal(row().tier, 'pro'); assert.equal(row().status, 'active');
    assert.equal(new Date(row().expires_at).getTime(), exp); assert.equal(row().product_id, 'vibebuild_pro_monthly');
    const st = await (await fetch(`${srv.base}/api/subscriptions/status?userId=${USER}`)).json();
    assert.equal(st.tier, 'pro'); assert.equal(st.platform, 'android'); assert.equal(st.limits.canCreatePrivateProjects, true);
});

test('an iOS App Store event is stored as ios; a team product is team', async () => {
    await post(ev('INITIAL_PURCHASE', { store: 'APP_STORE', product_id: 'vibebuild_team_monthly', entitlement_ids: [] }));
    assert.equal(row().platform, 'ios'); assert.equal(row().tier, 'team');
});

test('anonymous RevenueCat id: skipped, reported, nothing written, answered 200 (no pointless retries)', async () => {
    const r = await post(ev('INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:abc123' })); await settle();
    assert.equal(r.status, 200); assert.equal(mem.writes.length, 0);
    assert.deepEqual(sent.map((s) => [s.flow, s.context.reason]), [['billing:revenuecat_webhook_skipped', 'unmapped_user']]);
    assert.equal(JSON.stringify(sent).includes(USER), false);
});

test('the Supabase id is found among the aliases when app_user_id is still the anonymous id', async () => {
    await post(ev('RENEWAL', { app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc', USER] }));
    assert.equal(row().tier, 'pro');
});

test('two different user ids among the aliases is ambiguous: skipped, not guessed', async () => {
    await post(ev('RENEWAL', { app_user_id: '$RCAnonymousID:abc', aliases: [USER, OTHER] }));
    assert.equal(mem.writes.length, 0);
});

test('duplicate delivery of the same event id is acknowledged and applied once', async () => {
    const body = ev('INITIAL_PURCHASE');
    await post(body); const r = await post(body);
    assert.equal(r.status, 200); assert.equal((await r.json()).duplicate, true); assert.equal(mem.writes.length, 1);
});

test('out of order: an older event arriving late does not overwrite a newer one', async () => {
    const t = Date.now();
    await post(ev('RENEWAL', { event_timestamp_ms: t, expiration_at_ms: t + 60 * DAY }));
    const r = await post(ev('INITIAL_PURCHASE', { event_timestamp_ms: t - 30 * DAY, expiration_at_ms: t + 30 * DAY }));
    assert.equal(r.status, 200);
    assert.equal(new Date(row().expires_at).getTime(), t + 60 * DAY); assert.equal(mem.writes.length, 1);
});

test('out of order: a late stale RENEWAL cannot undo an EXPIRATION', async () => {
    const t = Date.now();
    await post(ev('INITIAL_PURCHASE', { event_timestamp_ms: t - 40 * DAY, expiration_at_ms: t + 10 * DAY }));
    await post(ev('EXPIRATION', { event_timestamp_ms: t - 1000, expiration_at_ms: t - 1000 }));
    assert.equal(row().tier, 'free'); assert.equal(row().status, 'expired');
    await post(ev('RENEWAL', { event_timestamp_ms: t - 20 * DAY, expiration_at_ms: t + 40 * DAY }));
    assert.equal(row().tier, 'free'); assert.equal((await getSubscriptionStatus(USER)).tier, 'free');
});

test('an event whose expiry is already past leaves the user free (expired at write time)', async () => {
    await post(ev('INITIAL_PURCHASE', { expiration_at_ms: Date.now() - DAY }));
    assert.equal(row().status, 'expired'); assert.equal(row().tier, 'free');
    assert.equal((await getSubscriptionStatus(USER)).tier, 'free');
});

test('read side: an unexpired mobile row is pro, and the same row is free once expires_at passes', async () => {
    mem.subs.set(USER, { user_id: USER, tier: 'pro', status: 'active', platform: 'android', expires_at: new Date(Date.now() + DAY).toISOString() });
    assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
    mem.subs.set(USER, { user_id: USER, tier: 'pro', status: 'active', platform: 'android', expires_at: new Date(Date.now() - 1000).toISOString() });
    const s = await getSubscriptionStatus(USER); assert.equal(s.tier, 'free'); assert.equal(s.status, 'expired');
});

test('CANCELLATION (auto-renew off) keeps access until the store expiry; a refund ends it now', async () => {
    const t = Date.now();
    await post(ev('INITIAL_PURCHASE', { event_timestamp_ms: t - 5000, expiration_at_ms: t + 20 * DAY }));
    await post(ev('CANCELLATION', { cancel_reason: 'UNSUBSCRIBE', event_timestamp_ms: t - 4000, expiration_at_ms: t + 20 * DAY }));
    assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
    await post(ev('CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT', event_timestamp_ms: t - 3000, expiration_at_ms: t - 3000 }));
    assert.equal(row().status, 'cancelled'); assert.equal((await getSubscriptionStatus(USER)).tier, 'free');
});

test('UNCANCELLATION and PRODUCT_CHANGE keep/refresh the grant', async () => {
    const t = Date.now();
    await post(ev('INITIAL_PURCHASE', { event_timestamp_ms: t - 5000 }));
    await post(ev('PRODUCT_CHANGE', { event_timestamp_ms: t - 4000, new_product_id: 'vibebuild_team_yearly', entitlement_ids: [] }));
    assert.equal(row().tier, 'team'); assert.equal(row().product_id, 'vibebuild_team_yearly');
    await post(ev('UNCANCELLATION', { event_timestamp_ms: t - 3000, product_id: 'vibebuild_team_yearly', entitlement_ids: ['team'] }));
    assert.equal(row().tier, 'team'); assert.equal(row().status, 'active');
});

test('BILLING_ISSUE keeps access only through the store grace period; SUBSCRIPTION_PAUSED runs to period end', async () => {
    const t = Date.now();
    await post(ev('INITIAL_PURCHASE', { event_timestamp_ms: t - 5000, expiration_at_ms: t + DAY }));
    await post(ev('BILLING_ISSUE', { event_timestamp_ms: t - 4000, expiration_at_ms: t + DAY, grace_period_expires_at_ms: t + 3 * DAY }));
    assert.equal(row().status, 'past_due'); assert.equal(new Date(row().expires_at).getTime(), t + 3 * DAY);
    assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
    await post(ev('BILLING_ISSUE', { event_timestamp_ms: t - 3000, expiration_at_ms: t - 1000 }));
    assert.equal((await getSubscriptionStatus(USER)).tier, 'free');
    await post(ev('RENEWAL', { event_timestamp_ms: t - 2000, expiration_at_ms: t + 30 * DAY }));
    await post(ev('SUBSCRIPTION_PAUSED', { event_timestamp_ms: t - 1500, expiration_at_ms: t + 5 * DAY }));
    assert.equal(new Date(row().expires_at).getTime(), t + 5 * DAY);
});

test('events for a user with no mobile row (cancel, expire, billing issue) do nothing', async () => {
    for (const type of ['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED']) assert.equal((await post(ev(type))).status, 200);
    assert.equal(mem.writes.length, 0);
});

test('one row per user: an active web or winback row is never replaced or downgraded by a mobile event', async () => {
    for (const platform of ['web', 'winback']) {
        mem.subs.clear(); mem.writes.length = 0; mem.events.clear(); sent.length = 0;
        mem.subs.set(USER, { user_id: USER, tier: 'pro', status: 'active', platform, product_id: 'sub_web1', expires_at: null });
        await post(ev('INITIAL_PURCHASE')); await post(ev('EXPIRATION', { expiration_at_ms: Date.now() - 1000 })); await settle();
        assert.equal(mem.writes.length, 0, platform); assert.equal(row().platform, platform); assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
        assert.ok(sent.some((s) => s.context?.reason === 'other_active_source'));
    }
});

test('a lapsed web row IS replaced by a new mobile purchase', async () => {
    mem.subs.set(USER, { user_id: USER, tier: 'free', status: 'cancelled', platform: 'web', product_id: 'sub_old', expires_at: null });
    await post(ev('INITIAL_PURCHASE')); assert.equal(row().platform, 'android'); assert.equal(row().tier, 'pro');
});

test('EXPIRATION from the other store or for another product does not drop an active subscription', async () => {
    const t = Date.now();
    await post(ev('INITIAL_PURCHASE', { event_timestamp_ms: t - 5000 }));
    await post(ev('EXPIRATION', { store: 'APP_STORE', event_timestamp_ms: t - 4000, expiration_at_ms: t - 4000 }));
    await post(ev('EXPIRATION', { product_id: 'something_else', event_timestamp_ms: t - 3000, expiration_at_ms: t - 3000 }));
    assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
});

test('unsupported store, unhandled event type and a grant without an expiry are skipped and reported', async () => {
    await post(ev('INITIAL_PURCHASE', { store: 'STRIPE' }));
    await post(ev('NON_RENEWING_PURCHASE'));
    await post(ev('INITIAL_PURCHASE', { expiration_at_ms: null })); await settle();
    assert.equal(mem.writes.length, 0);
    assert.deepEqual(sent.map((s) => s.context.reason), ['unsupported_store', 'unhandled_type', 'missing_expiry']);
});

test('database failure: 500 so RevenueCat retries, reported without user ids', async () => {
    mem.failWrites = true;
    const r = await post(ev('INITIAL_PURCHASE')); await settle();
    assert.equal(r.status, 500);
    assert.deepEqual(sent.map((s) => [s.flow, s.message]), [['billing:revenuecat_webhook_processing', 'RevenueCat webhook processing failed']]);
    assert.equal(JSON.stringify(sent).includes(USER), false);
    mem.failWrites = false; assert.equal((await post(ev('INITIAL_PURCHASE'))).status, 200); // the redelivery works
});

test('before the event-log migration is applied the webhook still works (fail soft) and reports the missing table once', async () => {
    mem.eventsTable = false;
    await post(ev('INITIAL_PURCHASE')); await post(ev('RENEWAL', { event_timestamp_ms: Date.now() + 1000 })); await settle();
    assert.equal(row().tier, 'pro');
    assert.deepEqual(sent.map((s) => s.flow), ['billing:event_log_unavailable']);
});

// ---- TRANSFER and verify use RevenueCat's REST API (server secret) ----
const subscriber = (days) => ({ ok: true, status: 200, json: async () => ({ subscriber: { entitlements: { pro: { expires_date: new Date(Date.now() + days * DAY).toISOString(), product_identifier: 'vibebuild_pro_yearly' } }, subscriptions: { vibebuild_pro_yearly: { store: 'play_store' } } } }) });

test('TRANSFER (anonymous purchase moved to the logged-in id) re-reads RevenueCat and grants the user', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'sk_test_not_real'; const calls = [];
    _setRevenueCatFetch(async (url, init) => { calls.push([url, init.headers.Authorization]); return subscriber(300); });
    const r = await post(ev('TRANSFER', { app_user_id: undefined, transferred_from: ['$RCAnonymousID:zzz'], transferred_to: [USER] }));
    assert.equal(r.status, 200); assert.equal(row().tier, 'pro'); assert.equal(row().platform, 'android'); assert.equal(row().product_id, 'vibebuild_pro_yearly');
    assert.ok(calls[0][0].endsWith(`/subscribers/${USER}`)); assert.equal(calls[0][1], 'Bearer sk_test_not_real');
    assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
});

test('TRANSFER away from a user ends their mobile row when RevenueCat no longer shows an entitlement', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'sk_test_not_real';
    mem.subs.set(OTHER, { user_id: OTHER, tier: 'pro', status: 'active', platform: 'android', product_id: 'p', expires_at: new Date(Date.now() + DAY).toISOString() });
    _setRevenueCatFetch(async (url) => (url.includes(OTHER) ? { ok: true, status: 200, json: async () => ({ subscriber: { entitlements: {}, subscriptions: {} } }) } : subscriber(300)));
    await post(ev('TRANSFER', { transferred_from: [OTHER], transferred_to: [USER] }));
    assert.equal((await getSubscriptionStatus(OTHER)).tier, 'free'); assert.equal((await getSubscriptionStatus(USER)).tier, 'pro');
});

test('TRANSFER without REVENUECAT_SECRET_API_KEY is skipped and reported, not guessed', async () => {
    const r = await post(ev('TRANSFER', { transferred_to: [USER] })); await settle();
    assert.equal(r.status, 200); assert.equal(mem.writes.length, 0);
    assert.deepEqual(sent.map((s) => s.context.reason), ['rest_not_configured']);
});

test('TRANSFER with RevenueCat REST failing is 500 so RevenueCat retries', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'sk_test_not_real'; _setRevenueCatFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    assert.equal((await post(ev('TRANSFER', { transferred_to: [USER] }))).status, 500);
});

const verify = (userId) => fetch(`${srv.base}/api/subscriptions/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId, platform: 'android', receiptData: 'ignored-client-string' }) });

test('verify with the RevenueCat secret set syncs the account from RevenueCat and ignores the client receipt string', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'sk_test_not_real'; _setRevenueCatFetch(async () => subscriber(100));
    const r = await verify(USER); const j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.tier, 'pro'); assert.equal(row().platform, 'android');
});

test('verify with nothing active at RevenueCat is a refusal and writes nothing; non-account ids are refused before any call', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'sk_test_not_real'; let called = 0;
    _setRevenueCatFetch(async () => { called++; return { ok: true, status: 200, json: async () => ({ subscriber: { entitlements: {}, subscriptions: {} } }) }; });
    assert.equal((await verify(USER)).status, 400); assert.equal(mem.writes.length, 0);
    assert.equal((await verify('not-a-uuid')).status, 400); assert.equal(called, 1);
});

test('verify with RevenueCat unreachable is 502 and reported', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'sk_test_not_real'; _setRevenueCatFetch(async () => { throw new Error('network'); });
    assert.equal((await verify(USER)).status, 502); await settle(); assert.equal(sent[0].flow, 'billing:revenuecat_verify');
});
