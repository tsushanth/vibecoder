import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyStripeSignature, buildCheckoutForm, createCheckoutSession, keyMode, TOLERANCE_SEC } from '../stripe.js';

// Fixtures are assembled from fragments so no secret-shaped literal exists in the repo.
const WH = ['whsec', 'testvector'].join('_');
const SK = (mode) => ['sk', mode, 'FAKEFIXTURE0123456789abcdef'].join('_');

// Hand-computed with `openssl dgst -sha256 -hmac` (independent of node:crypto in the code under test).
const BODY = Buffer.from('{"id":"evt_1","type":"checkout.session.completed"}');
const T = 1700000000;
const VECTOR = 'affe1a3caf29b9ba1dbcd47a14bec2cc11df01ea6a0fa2ff5577c42981361aa6';
const hdr = (t, ...sigs) => `t=${t},${sigs.map((s) => `v1=${s}`).join(',')}`;

test('hand-computed vector verifies', () => {
    assert.deepEqual(verifyStripeSignature({ rawBody: BODY, header: hdr(T, VECTOR), secret: WH, nowSec: T }), { ok: true });
});

test('tolerance is 300 seconds: edges accepted, 301 rejected, both directions', () => {
    assert.equal(TOLERANCE_SEC, 300);
    const sig = (t) => createHmac('sha256', WH).update(`${t}.`).update(BODY).digest('hex');
    for (const now of [T + 300, T - 300]) assert.equal(verifyStripeSignature({ rawBody: BODY, header: hdr(T, sig(T)), secret: WH, nowSec: now }).ok, true);
    for (const now of [T + 301, T - 301, T + 86400]) assert.deepEqual(verifyStripeSignature({ rawBody: BODY, header: hdr(T, sig(T)), secret: WH, nowSec: now }), { ok: false, reason: 'stale' });
});

test('a replay with a fresh timestamp on an old signature fails (timestamp is signed)', () => {
    assert.deepEqual(verifyStripeSignature({ rawBody: BODY, header: hdr(T + 100, VECTOR), secret: WH, nowSec: T + 100 }), { ok: false, reason: 'mismatch' });
});

test('tampered body, wrong secret and truncated signature all fail', () => {
    assert.equal(verifyStripeSignature({ rawBody: Buffer.from(BODY.toString().replace('evt_1', 'evt_2')), header: hdr(T, VECTOR), secret: WH, nowSec: T }).reason, 'mismatch');
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: hdr(T, VECTOR), secret: WH + 'x', nowSec: T }).reason, 'mismatch');
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: hdr(T, VECTOR.slice(0, 62)), secret: WH, nowSec: T }).reason, 'mismatch');
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: hdr(T, VECTOR.slice(0, 63) + (VECTOR[63] === '0' ? '1' : '0')), secret: WH, nowSec: T }).reason, 'mismatch');
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: hdr(T, VECTOR + '00'), secret: WH, nowSec: T }).reason, 'mismatch');
});

test('any one matching v1 among several is enough; v0 signatures are ignored', () => {
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: hdr(T, 'a'.repeat(64), VECTOR), secret: WH, nowSec: T }).ok, true);
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: `t=${T},v0=${VECTOR}`, secret: WH, nowSec: T }).reason, 'malformed');
});

test('the signature is over the raw bytes: re-serialised JSON does not verify', () => {
    const pretty = Buffer.from(JSON.stringify(JSON.parse(BODY.toString()), null, 2));
    assert.equal(verifyStripeSignature({ rawBody: pretty, header: hdr(T, VECTOR), secret: WH, nowSec: T }).reason, 'mismatch');
});

test('missing or malformed headers are rejected before any HMAC', () => {
    const v = (header, extra = {}) => verifyStripeSignature({ rawBody: BODY, header, secret: WH, nowSec: T, ...extra });
    assert.equal(v(undefined).reason, 'missing_header');
    assert.equal(v('').reason, 'missing_header');
    assert.equal(v('garbage').reason, 'malformed');
    assert.equal(v(`v1=${VECTOR}`).reason, 'malformed');
    assert.equal(v(`t=abc,v1=${VECTOR}`).reason, 'malformed');
    assert.equal(v(`t=${T}`).reason, 'malformed');
    assert.equal(v(`t=${T},v1=zz${VECTOR.slice(2)}`).reason, 'mismatch');
    assert.equal(v(hdr(T, VECTOR), { secret: '' }).reason, 'no_secret');
    assert.equal(v(hdr(T, VECTOR), { secret: undefined }).reason, 'no_secret');
    assert.equal(v('x'.repeat(5000)).reason, 'malformed');
});

test('an over-long header is refused even when it contains a valid signature', () => {
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: hdr(T, VECTOR) + ',x=' + 'y'.repeat(2000), secret: WH, nowSec: T }).reason, 'malformed');
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: hdr(T, VECTOR) + ',x=' + 'y'.repeat(100), secret: WH, nowSec: T }).ok, true);
});

test('the timestamp must be plain digits and the first t wins only if valid', () => {
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: `t=-${T},v1=${VECTOR}`, secret: WH, nowSec: T }).reason, 'malformed');
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: `t=${T}.5,v1=${VECTOR}`, secret: WH, nowSec: T }).reason, 'malformed');
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: `t=${T}9999999999,v1=${VECTOR}`, secret: WH, nowSec: T }).reason, 'malformed');
});

test('uses the full whsec string as the key (not the part after the prefix)', () => {
    const wrong = createHmac('sha256', 'testvector').update(`${T}.`).update(BODY).digest('hex');
    assert.equal(verifyStripeSignature({ rawBody: BODY, header: hdr(T, wrong), secret: WH, nowSec: T }).reason, 'mismatch');
});

test('keyMode flags test keys from the prefix and treats everything else as live', () => {
    assert.equal(keyMode(SK('test')), 'test');
    assert.equal(keyMode(['rk', 'test', 'abc'].join('_')), 'test');
    assert.equal(keyMode(SK('live')), 'live');
    assert.equal(keyMode(['rk', 'live', 'abc'].join('_')), 'live');
    assert.equal(keyMode('whatever'), 'live');
});

const ITEM = { id: 'pro', name: 'Pro & "Plus" plan', amountCents: 1999, currency: 'usd', mode: 'payment', maxQuantity: 3 };
const form = (o = {}) => Object.fromEntries(new URLSearchParams(buildCheckoutForm({ item: ITEM, quantity: 2, successUrl: 'https://a.example/?ok=1', cancelUrl: 'https://a.example/', appId: 'shop', ...o })));

test('form for a one-time item has exactly the expected fields, all from the catalog', () => {
    assert.deepEqual(form(), {
        mode: 'payment',
        success_url: 'https://a.example/?ok=1',
        cancel_url: 'https://a.example/',
        'line_items[0][quantity]': '2',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': '1999',
        'line_items[0][price_data][product_data][name]': 'Pro & "Plus" plan',
        'metadata[vibe_app]': 'shop',
        'metadata[vibe_item]': 'pro',
        'metadata[vibe_qty]': '2',
    });
});

test('subscription adds the recurring interval and mode', () => {
    const f = form({ item: { ...ITEM, mode: 'subscription', interval: 'year' } });
    assert.equal(f.mode, 'subscription');
    assert.equal(f['line_items[0][price_data][recurring][interval]'], 'year');
});

test('one-time items never carry a recurring field', () => assert.equal('line_items[0][price_data][recurring][interval]' in form(), false));

test('client_reference_id and customer_email are included only when given', () => {
    const f = form({ clientReferenceId: 'user-1', customerEmail: 'a@b.co' });
    assert.equal(f.client_reference_id, 'user-1'); assert.equal(f.customer_email, 'a@b.co');
    assert.equal('client_reference_id' in form(), false); assert.equal('customer_email' in form(), false);
});

const URL_OK = 'https://checkout.stripe.com/c/pay/cs_test_FAKE#frag';
const fakeFetch = (reply) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return typeof reply === 'function' ? reply(url, init) : reply; }; f.calls = calls; return f; };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const make = (f, extra = {}) => createCheckoutSession({ secretKey: SK('test'), body: 'mode=payment', fetchImpl: f, ...extra });

test('posts to the Checkout Sessions endpoint with bearer auth, form encoding, manual redirect and a timeout signal', async () => {
    const f = fakeFetch(json(200, { id: 'cs_1', url: URL_OK }));
    const r = await make(f);
    assert.deepEqual(r, { ok: true, url: URL_OK, id: 'cs_1' });
    const c = f.calls[0];
    assert.equal(c.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.headers.authorization, `Bearer ${SK('test')}`);
    assert.equal(c.init.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(c.init.body, 'mode=payment');
    assert.equal(c.init.redirect, 'manual');
    assert.ok(c.init.signal);
});

test('Stripe errors map to short codes and never echo Stripe text, the key or card data', async () => {
    const leak = { error: { message: `Invalid API Key provided: ${SK('test').slice(0, 12)}**** card 4242424242424242`, type: 'invalid_request_error' } };
    const cases = [[401, 'stripe_key_invalid'], [403, 'stripe_key_invalid'], [429, 'stripe_rate_limited'], [400, 'stripe_rejected'], [402, 'stripe_rejected'], [500, 'stripe_unavailable'], [503, 'stripe_unavailable']];
    for (const [status, code] of cases) {
        const r = await make(fakeFetch(json(status, leak)));
        assert.deepEqual(r, { ok: false, code }, String(status));
        assert.ok(!JSON.stringify(r).includes('4242') && !JSON.stringify(r).includes('FAKEFIXTURE'));
    }
});

test('network failure, timeout, bad JSON, missing url, non-Stripe url and redirects are all mapped', async () => {
    assert.deepEqual(await make(fakeFetch(() => { throw new TypeError('boom ' + SK('test')); })), { ok: false, code: 'stripe_unavailable' });
    const abort = async (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
    assert.deepEqual(await make(abort, { timeoutMs: 20 }), { ok: false, code: 'stripe_timeout' });
    assert.deepEqual(await make(fakeFetch(new Response('<html>', { status: 200 }))), { ok: false, code: 'stripe_bad_response' });
    assert.deepEqual(await make(fakeFetch(json(200, { id: 'cs_1' }))), { ok: false, code: 'stripe_bad_response' });
    for (const url of ['https://evil.example/pay', 'http://checkout.stripe.com/x', 'https://checkout.stripe.com.evil.example/x', 'https://x@evil.example/', 'javascript:alert(1)', 'https://evil.stripe.com/x', 'https://u:p@checkout.stripe.com/x', 'https://user@checkout.stripe.com/x', 5]) assert.deepEqual(await make(fakeFetch(json(200, { id: 'cs_1', url }))), { ok: false, code: 'stripe_bad_response' }, String(url));
    assert.deepEqual(await make(fakeFetch(new Response(null, { status: 302, headers: { location: 'https://evil.example' } }))), { ok: false, code: 'stripe_bad_response' });
    assert.deepEqual(await make(fakeFetch(json(200, { id: 5, url: URL_OK }))), { ok: false, code: 'stripe_bad_response' });
    assert.deepEqual(await make(fakeFetch(json(302, { id: 'cs_1', url: URL_OK }))), { ok: false, code: 'stripe_bad_response' });
    assert.deepEqual(await make(fakeFetch(json(200, { id: 'cs_1', url: URL_OK, pad: 'x'.repeat(300 * 1024) }))), { ok: false, code: 'stripe_bad_response' });
});
