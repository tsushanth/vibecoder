import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createPayService } from '../service.js';
import { createLimiter, memoryStore } from '../../vibe-proxy/limits.js';

const SK = (m) => ['sk', m, 'FAKEFIXTURE0123456789abcdef'].join('_');
const WH = ['whsec', 'unit', 'fixture'].join('_');
const CATALOG = [
    { id: 'pro', name: 'Pro plan', amountCents: 1999, currency: 'usd', mode: 'payment', maxQuantity: 3 },
    { id: 'sub', name: 'Monthly', amountCents: 500, currency: 'eur', mode: 'subscription', interval: 'month' },
];
const APP = { enabled: true, domains: ['shop.example.com'], manifest: { pay: { catalog: CATALOG } } };
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_FAKE';

function boot(o = {}) {
    let t = Date.UTC(2026, 9, 5, 12, 0, 10);
    const now = () => t;
    const store = memoryStore({ now });
    const limiter = createLimiter({ store, now, perIpPerMin: 1000, perAppPerMin: 1000, dailyCalls: 1000 });
    const secrets = { STRIPE_SECRET_KEY: SK('test'), STRIPE_WEBHOOK_SECRET: WH, ...(o.secrets || {}) };
    const secretStore = { get: async (appId, name) => { if (o.secretThrows) throw new Error('secret_decrypt_failed'); return secrets[`${appId}:${name}`] ?? secrets[name]; } };
    const stripeCalls = [];
    const fetchImpl = async (url, init) => { stripeCalls.push({ url, init, form: Object.fromEntries(new URLSearchParams(init.body)) }); return o.stripe ? o.stripe() : new Response(JSON.stringify({ id: 'cs_1', url: CHECKOUT_URL }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    const orders = [];
    const orderStore = {
        async record(r) { if (orders.some((x) => x.appId === r.appId && x.sessionId === r.sessionId)) return { created: false }; orders.push(r); return { created: true }; },
        async listForUser({ appId, userId }) { return orders.filter((x) => x.appId === appId && x.clientReferenceId === userId); },
    };
    const sessions = { tok: { ok: true, user: { id: 'u-1', email: 'buyer@example.com' } } };
    const verified = [];
    const auth = { verifySession: async ({ appId, token }) => { verified.push([appId, token]); return sessions[token] || { ok: false }; } };
    const svc = createPayService({ secretStore, limiter, limiterStore: store, orderStore, auth: o.noAuth ? undefined : auth, fetchImpl, baseDomain: 'vibebuild.cc', now, limits: o.limits });
    return { svc, store, stripeCalls, orders, verified, advance: (ms) => { t += ms; }, now };
}
const co = (b, o = {}) => ({ appId: 'shop', app: APP, ip: '1.1.1.1', ...o, body: b });

test('creates a session from the catalog only and returns the url with the key mode', async () => {
    const { svc, stripeCalls } = boot();
    const r = await svc.checkout(co({ item: 'pro', quantity: 2 }));
    assert.deepEqual(r, { status: 200, body: { url: CHECKOUT_URL, mode: 'test' } });
    const f = stripeCalls[0].form;
    assert.equal(f['line_items[0][price_data][unit_amount]'], '1999');
    assert.equal(f['line_items[0][price_data][currency]'], 'usd');
    assert.equal(f['line_items[0][price_data][product_data][name]'], 'Pro plan');
    assert.equal(f['line_items[0][quantity]'], '2');
    assert.equal(f.mode, 'payment');
    assert.equal(f['metadata[vibe_app]'], 'shop'); assert.equal(f['metadata[vibe_item]'], 'pro'); assert.equal(f['metadata[vibe_qty]'], '2');
    assert.equal(stripeCalls[0].init.headers.authorization, `Bearer ${SK('test')}`);
});

test('a live key is flagged live and the response never contains the key', async () => {
    const { svc } = boot({ secrets: { STRIPE_SECRET_KEY: SK('live') } });
    const r = await svc.checkout(co({ item: 'pro' }));
    assert.equal(r.body.mode, 'live');
    assert.ok(!JSON.stringify(r).includes('FAKEFIXTURE'));
});

test('browser-supplied amount, currency, name, mode, price and unknown fields are ignored', async () => {
    const { svc, stripeCalls } = boot();
    await svc.checkout(co({ item: 'pro', quantity: 1, amountCents: 1, amount: 1, currency: 'eur', name: 'Free', mode: 'subscription', price: 'price_x', unit_amount: 1, metadata: { x: 1 }, success_url: 'https://evil.example' }));
    const f = stripeCalls[0].form;
    assert.equal(f['line_items[0][price_data][unit_amount]'], '1999'); assert.equal(f['line_items[0][price_data][currency]'], 'usd');
    assert.equal(f['line_items[0][price_data][product_data][name]'], 'Pro plan'); assert.equal(f.mode, 'payment');
    assert.ok(!JSON.stringify(f).includes('evil'));
});

test('a subscription item sends the recurring interval', async () => {
    const { svc, stripeCalls } = boot();
    await svc.checkout(co({ item: 'sub' }));
    assert.equal(stripeCalls[0].form.mode, 'subscription');
    assert.equal(stripeCalls[0].form['line_items[0][price_data][recurring][interval]'], 'month');
    assert.equal(stripeCalls[0].form['line_items[0][quantity]'], '1');
});

test('success and cancel URLs are fixed to the app origin; default path is /', async () => {
    const { svc, stripeCalls } = boot();
    await svc.checkout(co({ item: 'pro' }));
    assert.equal(stripeCalls[0].form.success_url, 'https://shop.vibebuild.cc/?vibe_pay=success&session_id={CHECKOUT_SESSION_ID}');
    assert.equal(stripeCalls[0].form.cancel_url, 'https://shop.vibebuild.cc/?vibe_pay=cancel');
});

test('a safe relative path is honoured for both URLs', async () => {
    const { svc, stripeCalls } = boot();
    await svc.checkout(co({ item: 'pro', successPath: '/thanks/order-1', cancelPath: '/cart' }));
    assert.equal(stripeCalls[0].form.success_url, 'https://shop.vibebuild.cc/thanks/order-1?vibe_pay=success&session_id={CHECKOUT_SESSION_ID}');
    assert.equal(stripeCalls[0].form.cancel_url, 'https://shop.vibebuild.cc/cart?vibe_pay=cancel');
});

test('unsafe paths are refused and nothing reaches Stripe', async () => {
    for (const p of ['https://evil.example/', '//evil.example', 'thanks', '/a?x=1', '/a#f', '/a/../b', '/./a', '/a\\b', '/a b', '/%2e%2e/x', '/' + 'a'.repeat(200), 5, null, {}]) {
        const { svc, stripeCalls } = boot();
        for (const key of ['successPath', 'cancelPath']) {
            assert.deepEqual(await svc.checkout(co({ item: 'pro', [key]: p })), { status: 400, body: { error: 'bad_path' } }, `${key} ${String(p).slice(0, 20)}`);
        }
        assert.equal(stripeCalls.length, 0);
    }
});

test('a path of exactly 200 characters is accepted', async () => {
    const { svc } = boot();
    assert.equal((await svc.checkout(co({ item: 'pro', successPath: '/' + 'a'.repeat(199) }))).status, 200);
});

test('the origin used is the request Origin only when it is the app custom domain, else the platform host', async () => {
    for (const [origin, want] of [['https://shop.example.com', 'https://shop.example.com/'], ['https://evil.example', 'https://shop.vibebuild.cc/'], ['http://shop.example.com', 'https://shop.vibebuild.cc/'], ['not a url', 'https://shop.vibebuild.cc/'], [undefined, 'https://shop.vibebuild.cc/']]) {
        const { svc, stripeCalls } = boot();
        await svc.checkout(co({ item: 'pro' }, { origin }));
        assert.ok(stripeCalls[0].form.success_url.startsWith(want + '?vibe_pay=success'), `${origin} -> ${stripeCalls[0].form.success_url}`);
        assert.ok(stripeCalls[0].form.cancel_url.startsWith(want), origin);
    }
});

test('item and quantity validation', async () => {
    const { svc, stripeCalls } = boot();
    const e = async (b) => (await svc.checkout(co(b)));
    assert.deepEqual(await e({ item: 'nope' }), { status: 404, body: { error: 'unknown_item' } });
    assert.deepEqual(await e({ item: 'constructor' }), { status: 404, body: { error: 'unknown_item' } });
    for (const b of [{}, { item: 5 }, { item: '' }, null, { item: ['pro'] }]) assert.deepEqual(await e(b), { status: 400, body: { error: 'bad_request' } });
    for (const q of [0, -1, 4, 1.5, '2', null, NaN, Infinity]) assert.deepEqual(await e({ item: 'pro', quantity: q }), { status: 400, body: { error: 'bad_quantity' } }, String(q));
    assert.deepEqual(await e({ item: 'sub', quantity: 2 }), { status: 400, body: { error: 'bad_quantity' } }, 'default maxQuantity is 1');
    assert.equal((await e({ item: 'pro', quantity: 3 })).status, 200);
    assert.equal(stripeCalls.length, 1);
});

test('an app with no catalog, an invalid stored catalog or a missing key cannot check out', async () => {
    const { svc, stripeCalls } = boot();
    assert.deepEqual(await svc.checkout(co({ item: 'pro' }, { app: { enabled: true, manifest: null } })), { status: 404, body: { error: 'payments_not_configured' } });
    assert.deepEqual(await svc.checkout(co({ item: 'pro' }, { app: { enabled: true, manifest: { pay: { catalog: [{ id: 'pro', name: 'x', amountCents: 1, currency: 'usd', mode: 'payment' }] } } } })), { status: 404, body: { error: 'payments_not_configured' } });
    const b2 = boot({ secrets: { STRIPE_SECRET_KEY: '' } });
    assert.deepEqual(await b2.svc.checkout(co({ item: 'pro' })), { status: 424, body: { error: 'stripe_key_missing' } });
    assert.equal(stripeCalls.length + b2.stripeCalls.length, 0);
    assert.deepEqual(await boot({ secretThrows: true }).svc.checkout(co({ item: 'pro' })), { status: 500, body: { error: 'internal' } });
});

test('a disabled app and a kill switch both refuse checkout', async () => {
    const { svc, store, stripeCalls } = boot();
    assert.deepEqual(await svc.checkout(co({ item: 'pro' }, { app: { ...APP, enabled: false } })), { status: 403, body: { error: 'app_disabled' } });
    await store.set('kill:shop', 1, 3600);
    assert.deepEqual(await svc.checkout(co({ item: 'pro' })), { status: 403, body: { error: 'app_disabled' } });
    assert.equal(stripeCalls.length, 0);
});

test('the shared limiter gate is applied and limiter failure fails closed', async () => {
    const b = boot();
    b.store.get = async () => { throw new Error('db down'); };
    assert.deepEqual(await b.svc.checkout(co({ item: 'pro' })), { status: 503, body: { error: 'limiter_unavailable' }, headers: { 'retry-after': '30' } });
    const c = boot();
    const orig = c.store.incr;
    c.store.incr = async (k, ttl) => { if (k.startsWith('pay')) throw new Error('db down'); return orig(k, ttl); };
    assert.deepEqual(await c.svc.checkout(co({ item: 'pro' })), { status: 503, body: { error: 'limiter_unavailable' } });
    assert.equal(c.stripeCalls.length, 0);
});

test('per-IP hourly cap: the 11th session from one IP is refused, another IP is not, the next hour resets', async () => {
    const { svc, stripeCalls, advance } = boot();
    for (let i = 0; i < 10; i++) assert.equal((await svc.checkout(co({ item: 'pro' }))).status, 200, String(i));
    const r = await svc.checkout(co({ item: 'pro' }));
    assert.equal(r.status, 429); assert.equal(r.body.error, 'pay_rate_limited_ip'); assert.ok(Number(r.headers['retry-after']) > 0 && Number(r.headers['retry-after']) <= 3600);
    assert.equal(stripeCalls.length, 10);
    assert.equal((await svc.checkout(co({ item: 'pro' }, { ip: '2.2.2.2' }))).status, 200);
    advance(3600_000);
    assert.equal((await svc.checkout(co({ item: 'pro' }))).status, 200);
});

test('per-app hourly cap counts across IPs', async () => {
    const { svc } = boot({ limits: { checkoutPerAppPerHour: 3, checkoutPerIpPerHour: 100 } });
    for (let i = 0; i < 3; i++) assert.equal((await svc.checkout(co({ item: 'pro' }, { ip: `9.9.9.${i}` }))).status, 200);
    const r = await svc.checkout(co({ item: 'pro' }, { ip: '9.9.9.9' }));
    assert.equal(r.status, 429); assert.equal(r.body.error, 'pay_rate_limited_hour');
});

test('per-app hourly counters are per app and persist for the whole window', async () => {
    const { svc, advance } = boot({ limits: { checkoutPerAppPerHour: 3, checkoutPerIpPerHour: 100 } });
    for (let i = 0; i < 3; i++) { assert.equal((await svc.checkout(co({ item: 'pro' }, { ip: `8.8.8.${i}` }))).status, 200); advance(5000); }
    assert.equal((await svc.checkout(co({ item: 'pro' }, { ip: '8.8.8.9' }))).body.error, 'pay_rate_limited_hour');
    assert.equal((await svc.checkout(co({ item: 'pro' }, { appId: 'other' }))).status, 200, 'another app is not affected');
});

test('per-app daily cap survives the hour rolling over; another app is unaffected', async () => {
    const { svc, advance } = boot({ limits: { checkoutPerAppPerDay: 3, checkoutPerAppPerHour: 100, checkoutPerIpPerHour: 100 } });
    for (let i = 0; i < 3; i++) assert.equal((await svc.checkout(co({ item: 'pro' }))).status, 200);
    advance(3600_000);
    const r = await svc.checkout(co({ item: 'pro' }));
    assert.equal(r.status, 429); assert.equal(r.body.error, 'pay_daily_cap'); assert.ok(Number(r.headers['retry-after']) > 0);
    assert.equal((await svc.checkout(co({ item: 'pro' }, { appId: 'other' }))).status, 200);
});

test('invalid requests do not consume the Stripe session caps', async () => {
    const { svc } = boot({ limits: { checkoutPerIpPerHour: 2 } });
    for (let i = 0; i < 6; i++) await svc.checkout(co({ item: 'nope' }));
    assert.equal((await svc.checkout(co({ item: 'pro' }))).status, 200);
});

test('a valid session token attaches the user id and email; a bad token is treated as anonymous; no auth service is fine', async () => {
    const a = boot();
    await a.svc.checkout(co({ item: 'pro' }, { bearer: 'tok' }));
    assert.equal(a.stripeCalls[0].form.client_reference_id, 'u-1'); assert.equal(a.stripeCalls[0].form.customer_email, 'buyer@example.com');
    assert.deepEqual(a.verified, [['shop', 'tok']]);
    const b = boot();
    assert.equal((await b.svc.checkout(co({ item: 'pro' }, { bearer: 'bad' }))).status, 200);
    assert.equal('client_reference_id' in b.stripeCalls[0].form, false); assert.equal('customer_email' in b.stripeCalls[0].form, false);
    const c = boot();
    await c.svc.checkout(co({ item: 'pro' }));
    assert.deepEqual(c.verified, []);
    const d = boot({ noAuth: true });
    assert.equal((await d.svc.checkout(co({ item: 'pro' }, { bearer: 'tok' }))).status, 200);
    assert.equal('client_reference_id' in d.stripeCalls[0].form, false);
});

test('Stripe failures become short codes with the right status and leak nothing', async () => {
    const leak = () => new Response(JSON.stringify({ error: { message: `bad key ${SK('test')} card 4242424242424242` } }), { status: 401 });
    for (const [mk, status, code] of [[leak, 502, 'stripe_key_invalid'], [() => new Response('{}', { status: 429 }), 503, 'stripe_rate_limited'], [() => new Response('{}', { status: 400 }), 502, 'stripe_rejected'], [() => new Response('{}', { status: 500 }), 502, 'stripe_unavailable'], [() => new Response('nope', { status: 200 }), 502, 'stripe_bad_response']]) {
        const r = await boot({ stripe: mk }).svc.checkout(co({ item: 'pro' }));
        assert.deepEqual(r, { status, body: { error: code } });
    }
    const t = await boot({ stripe: () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }).svc.checkout(co({ item: 'pro' }));
    assert.deepEqual(t, { status: 504, body: { error: 'stripe_timeout' } });
});

// ---- webhook ----
const sign = (raw, { t, secret = WH } = {}) => { const ts = t ?? Math.floor(Date.UTC(2026, 9, 5, 12, 0, 10) / 1000); return `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex')}`; };
const session = (o = {}) => ({ id: 'cs_paid_1', object: 'checkout.session', payment_status: 'paid', amount_total: 3998, currency: 'usd', client_reference_id: 'u-1', customer_details: { email: 'buyer@example.com' }, metadata: { vibe_app: 'shop', vibe_item: 'pro', vibe_qty: '2' }, ...o });
const evt = (s = session(), type = 'checkout.session.completed') => Buffer.from(JSON.stringify({ id: 'evt_1', type, data: { object: s } }));
const hook = (svc, raw, signature = sign(raw), o = {}) => svc.webhook({ appId: 'shop', ip: '3.3.3.3', rawBody: raw, signature, ...o });

test('a valid checkout.session.completed records one paid order from the verified event', async () => {
    const { svc, orders } = boot();
    assert.deepEqual(await hook(svc, evt()), { status: 200, body: { received: true, duplicate: false } });
    assert.deepEqual(orders, [{ appId: 'shop', sessionId: 'cs_paid_1', itemId: 'pro', quantity: 2, amountCents: 3998, currency: 'usd', clientReferenceId: 'u-1', customerEmail: 'buyer@example.com' }]);
});

test('async_payment_succeeded also records; customer_email is the fallback email; absent ids become null', async () => {
    const { svc, orders } = boot();
    const s = session({ id: 'cs_async', customer_details: undefined, customer_email: 'x@y.co', client_reference_id: null });
    assert.equal((await hook(svc, evt(s, 'checkout.session.async_payment_succeeded'))).body.duplicate, false);
    assert.equal(orders[0].customerEmail, 'x@y.co'); assert.equal(orders[0].clientReferenceId, null);
});

test('the same session delivered twice is recorded once and the second answer is a 200 duplicate', async () => {
    const { svc, orders } = boot();
    await hook(svc, evt());
    assert.deepEqual(await hook(svc, evt()), { status: 200, body: { received: true, duplicate: true } });
    assert.equal(orders.length, 1);
});

test('bad signatures are all the same 400 and record nothing: missing, wrong secret, tampered, stale, replayed body with new timestamp', async () => {
    const { svc, orders } = boot();
    const raw = evt();
    const now = Math.floor(Date.UTC(2026, 9, 5, 12, 0, 10) / 1000);
    const cases = [null, '', 'garbage', sign(raw, { secret: WH + 'x' }), sign(evt(session({ amount_total: 1 }))), sign(raw, { t: now - 301 }), sign(raw, { t: now + 301 }), sign(raw).replace(/t=\d+/, `t=${now + 5}`)];
    for (const sig of cases) assert.deepEqual(await hook(svc, raw, sig), { status: 400, body: { error: 'bad_signature' } }, String(sig));
    assert.equal(orders.length, 0);
});

test('a valid signature made with another app webhook secret is refused', async () => {
    const { svc, orders } = boot({ secrets: { 'shop:STRIPE_WEBHOOK_SECRET': WH, 'other:STRIPE_WEBHOOK_SECRET': WH + '2' } });
    const raw = evt();
    assert.equal((await svc.webhook({ appId: 'shop', ip: '3.3.3.3', rawBody: raw, signature: sign(raw, { secret: WH + '2' }) })).status, 400);
    assert.equal(orders.length, 0);
});

test('no webhook secret stored: 503 and nothing recorded, even for a signature that would be valid for an empty key', async () => {
    const { svc, orders } = boot({ secrets: { STRIPE_WEBHOOK_SECRET: '' } });
    assert.deepEqual(await hook(svc, evt(), sign(evt(), { secret: '' })), { status: 503, body: { error: 'webhook_not_configured' } });
    assert.equal(orders.length, 0);
    assert.deepEqual(await hook(boot({ secretThrows: true }).svc, evt()), { status: 500, body: { error: 'internal' } });
});

test('a signed but non-JSON body is a 400 bad_payload', async () => {
    const { svc } = boot();
    const raw = Buffer.from('not json');
    assert.deepEqual(await hook(svc, raw), { status: 400, body: { error: 'bad_payload' } });
});

test('events that are not a paid session of this app are acknowledged and ignored', async () => {
    const { svc, orders } = boot();
    const ignored = { status: 200, body: { received: true, ignored: true } };
    const cases = [
        evt(session(), 'payment_intent.succeeded'),
        evt(session(), 'checkout.session.expired'),
        evt(session({ payment_status: 'unpaid' })),
        evt(session({ payment_status: 'no_payment_required' })),
        evt(session({ metadata: {} })),
        evt(session({ metadata: { vibe_app: 'other-app', vibe_item: 'pro', vibe_qty: '1' } })),
        evt(session({ metadata: { vibe_app: 'shop', vibe_qty: '1' } })),
        evt(session({ metadata: { vibe_app: 'shop', vibe_item: '', vibe_qty: '1' } })),
        evt(session({ metadata: { vibe_app: 'shop', vibe_item: 'pro', vibe_qty: '0' } })),
        evt(session({ metadata: { vibe_app: 'shop', vibe_item: 'pro', vibe_qty: '101' } })),
        evt(session({ metadata: { vibe_app: 'shop', vibe_item: 'pro', vibe_qty: '1.5' } })),
        evt(session({ metadata: { vibe_app: 'shop', vibe_item: 'x'.repeat(65), vibe_qty: '1' } })),
        evt(session({ id: '' })), evt(session({ id: 5 })), evt(session({ id: 'c'.repeat(256) })),
        evt(session({ amount_total: -1 })), evt(session({ amount_total: 1.5 })), evt(session({ amount_total: '5' })),
        evt(session({ currency: 'USD' })), evt(session({ currency: 'usdx' })), evt(session({ currency: undefined })),
        evt(session({ object: 'payment_intent' })),
        Buffer.from(JSON.stringify({ type: 'checkout.session.completed' })),
        Buffer.from('null'),
    ];
    for (const raw of cases) assert.deepEqual(await hook(svc, raw), ignored, raw.toString().slice(0, 90));
    assert.equal(orders.length, 0);
});

test('boundaries: quantity 1 and 100, amount 0 and a 255 char session id are recorded', async () => {
    const { svc, orders } = boot();
    await hook(svc, evt(session({ id: 'a'.repeat(255), amount_total: 0, metadata: { vibe_app: 'shop', vibe_item: 'x'.repeat(64), vibe_qty: '100' } })));
    await hook(svc, evt(session({ id: 'b', metadata: { vibe_app: 'shop', vibe_item: 'pro', vibe_qty: '1' } })));
    assert.deepEqual(orders.map((o) => [o.quantity, o.amountCents]), [[100, 0], [1, 3998]]);
});

test('the recorded item id is the one from the event, not a fixed value', async () => {
    const { svc, orders } = boot();
    await hook(svc, evt(session({ id: 'cs_item2', metadata: { vibe_app: 'shop', vibe_item: 'gold-pack', vibe_qty: '1' } })));
    assert.equal(orders[0].itemId, 'gold-pack');
});

test('over-long client reference and email are dropped rather than stored', async () => {
    const { svc, orders } = boot();
    await hook(svc, evt(session({ client_reference_id: 'r'.repeat(201), customer_details: { email: 'e'.repeat(250) + '@x.co' } })));
    assert.equal(orders[0].clientReferenceId, null); assert.equal(orders[0].customerEmail, null);
});

test('the webhook is still recorded when the app is disabled or killed (the money already moved)', async () => {
    const { svc, store, orders } = boot();
    await store.set('kill:shop', 1, 3600);
    assert.equal((await hook(svc, evt())).status, 200);
    assert.equal(orders.length, 1);
});

test('per-IP webhook limit: the 121st request in a minute is 429 before any HMAC work; limiter failure fails closed', async () => {
    const { svc, store } = boot();
    for (let i = 0; i < 120; i++) assert.equal((await hook(svc, evt(), 'bad')).status, 400, `request ${i + 1} is still within the limit`);
    const r = await hook(svc, evt(), 'bad');
    assert.equal(r.status, 429); assert.equal(r.body.error, 'rate_limited_ip');
    assert.equal((await hook(svc, evt(), 'bad', { ip: '4.4.4.4' })).status, 400);
    store.incr = async () => { throw new Error('down'); };
    assert.deepEqual(await hook(svc, evt(), 'bad', { ip: '5.5.5.5' }), { status: 503, body: { error: 'limiter_unavailable' } });
});

// ---- orders ----
test('orders returns only the signed-in user own orders for this app', async () => {
    const { svc, orders } = boot();
    await hook(svc, evt());
    await hook(svc, evt(session({ id: 'cs_other_user', client_reference_id: 'u-2' })));
    const r = await svc.orders({ appId: 'shop', app: APP, ip: '1.1.1.1', bearer: 'tok' });
    assert.equal(r.status, 200); assert.deepEqual(r.body.orders.map((o) => o.sessionId), ['cs_paid_1']);
    assert.equal(orders.length, 2);
});

test('orders needs a valid session, a live app, and passes the limiter gate', async () => {
    const { svc, store } = boot();
    for (const bearer of [undefined, 'bad']) assert.deepEqual(await svc.orders({ appId: 'shop', app: APP, ip: '1.1.1.1', bearer }), { status: 401, body: { error: 'unauthorized' } });
    assert.deepEqual(await svc.orders({ appId: 'shop', app: { ...APP, enabled: false }, ip: '1.1.1.1', bearer: 'tok' }), { status: 403, body: { error: 'app_disabled' } });
    await store.set('kill:shop', 1, 3600);
    assert.equal((await svc.orders({ appId: 'shop', app: APP, ip: '1.1.1.1', bearer: 'tok' })).status, 403);
    assert.deepEqual(await boot({ noAuth: true }).svc.orders({ appId: 'shop', app: APP, ip: '1.1.1.1', bearer: 'tok' }), { status: 401, body: { error: 'unauthorized' } });
});
