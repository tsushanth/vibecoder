// End to end over real HTTP with a real local Postgres (orders table, vault, limiter) and a fake Stripe fetch.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../../proxy-app/start.js';
import { createPgStores } from '../../store/pg.js';
import { loadConfig } from '../../proxy-app/config.js';

const SK = ['sk', 'test', 'FAKEE2EFIXTURE0123456789'].join('_');
const WH = ['whsec', 'e2e', 'fixture', '0123'].join('_');
const ADMIN_T = 'admin-' + 'z'.repeat(40);
const CATALOG = [{ id: 'pro', name: 'Pro plan', amountCents: 1999, currency: 'usd', mode: 'payment', maxQuantity: 3 }];
let db, skip, MK, mails = [], stripe = [], srv, stores;
const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://api.resend.com/')) { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
    if (u.startsWith('https://api.stripe.com/')) { stripe.push({ url: u, headers: init.headers, form: Object.fromEntries(new URLSearchParams(init.body)) }); return new Response(JSON.stringify({ id: 'cs_e2e', url: 'https://checkout.stripe.com/c/pay/cs_e2e' }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return new Response('{}', { status: 200 });
};
const cfg = (extra = {}) => loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: MK, OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PORT: '8080', PROXY_ADMIN_TOKEN: ADMIN_T, RESEND_API_KEY: 're_testkey12345', AUTH_MAIL_FROM: 'login@mail.vibebuild.cc', PER_IP_PER_MIN: '1000', ...extra });
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    MK = masterKey();
    stores = createPgStores({ pool: db.pool, masterKey: MK });
    for (const a of ['shop', 'shop2', 'bare']) await stores.upsertApp({ appId: a, enabled: true, domains: a === 'shop' ? ['shop.example.com'] : [] });
    for (const a of ['shop', 'shop2']) { await stores.setManifest(a, { pay: { catalog: CATALOG } }); await stores.secretStore.set(a, 'STRIPE_SECRET_KEY', SK); await stores.secretStore.set(a, 'STRIPE_WEBHOOK_SECRET', a === 'shop' ? WH : WH + '2'); }
    srv = await startServer(cfg(), { pool: db.pool, listenPort: 0, fetchImpl });
});
after(async () => { await srv?.close(); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); mails.length = 0; stripe.length = 0; await f(c); });
const base = () => `http://127.0.0.1:${srv.port}`;
let ipn = 10;
const ipHdr = () => ({ 'fly-client-ip': `9.7.${++ipn}.1` });
const post = (path, body, headers = {}) => fetch(`${base()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...ipHdr(), ...headers }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
const signIn = async (appId, email) => {
    await post(`/${appId}/auth/request`, { email });
    const link = new URL(/https:\/\/\S+/.exec(mails.at(-1).text)[0]).searchParams.get('vibe_login');
    return (await (await post(`/${appId}/auth/consume`, { token: link })).json()).token;
};
const sign = (raw, secret = WH, ts = Math.floor(Date.now() / 1000)) => `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex')}`;
const event = (sid, over = {}) => JSON.stringify({ id: 'evt_' + sid, type: 'checkout.session.completed', data: { object: { id: sid, object: 'checkout.session', payment_status: 'paid', amount_total: 3998, currency: 'usd', metadata: { vibe_app: 'shop', vibe_item: 'pro', vibe_qty: '2' }, ...over } } });
const hook = (appId, raw, sig = sign(raw), headers = {}) => post(`/${appId}/pay/webhook`, raw, { 'stripe-signature': sig, ...headers });

t('checkout over HTTP: stored key and catalog produce the exact Stripe request, CORS for the app origin, key never returned', async () => {
    const r = await post('/shop/pay/checkout', { item: 'pro', quantity: 2 }, { origin: 'https://shop.example.com' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body, { url: 'https://checkout.stripe.com/c/pay/cs_e2e', mode: 'test' });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://shop.example.com');
    assert.equal(stripe.length, 1);
    assert.equal(stripe[0].headers.authorization, `Bearer ${SK}`);
    assert.equal(stripe[0].form['line_items[0][price_data][unit_amount]'], '1999');
    assert.equal(stripe[0].form.success_url, 'https://shop.example.com/?vibe_pay=success&session_id={CHECKOUT_SESSION_ID}');
    assert.ok(!JSON.stringify(body).includes('FAKEE2E'));
});

t('checkout rejects a foreign Origin, non-POST, bad JSON, oversize bodies, unknown apps and apps without payments', async () => {
    assert.equal((await post('/shop/pay/checkout', { item: 'pro' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(`${base()}/shop/pay/checkout`, { method: 'GET' })).status, 405);
    for (const bad of ['not json', '[]', '"str"', '5', 'null']) { const r = await post('/shop/pay/checkout', bad); assert.deepEqual([r.status, (await r.json()).error], [400, 'bad_json'], bad); }
    assert.equal((await post('/shop/pay/checkout', JSON.stringify({ item: 'pro', pad: 'x'.repeat(9000) }))).status, 413);
    assert.equal((await post('/nope/pay/checkout', { item: 'pro' })).status, 404);
    assert.equal((await post('/bare/pay/checkout', { item: 'pro' })).status, 404);
    assert.equal(stripe.length, 0);
    const pre = await fetch(`${base()}/shop/pay/checkout`, { method: 'OPTIONS', headers: { origin: 'https://shop.example.com', ...ipHdr() } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
    assert.equal((await fetch(`${base()}/shop/pay/checkout`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', ...ipHdr() } })).status, 403);
});

t('the platform subdomain origin is allowed; http and look-alike origins are not', async () => {
    const ok = await post('/shop/pay/checkout', { item: 'pro' }, { origin: 'https://shop.vibebuild.cc' });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://shop.vibebuild.cc');
    assert.equal(stripe.at(-1).form.success_url.startsWith('https://shop.vibebuild.cc/?'), true);
    for (const o of ['http://shop.vibebuild.cc', 'https://shop.vibebuild.cc.evil.example', 'https://other.vibebuild.cc', 'http://shop.example.com']) assert.equal((await post('/shop/pay/checkout', { item: 'pro' }, { origin: o })).status, 403, o);
});

t('a disabled app cannot check out', async () => {
    await stores.upsertApp({ appId: 'shop3', enabled: false, manifest: { pay: { catalog: CATALOG } } });
    assert.equal((await post('/shop3/pay/checkout', { item: 'pro' })).status, 403);
});

t('signed-in checkout attaches the user; webhook records the order; orders returns only that user own order', async () => {
    const tok = await signIn('shop', 'buyer@example.com');
    const me = await (await post('/shop/auth/me', {}, { authorization: `Bearer ${tok}` })).json();
    await post('/shop/pay/checkout', { item: 'pro' }, { authorization: `Bearer ${tok}` });
    assert.equal(stripe[0].form.client_reference_id, me.user.id); assert.equal(stripe[0].form.customer_email, 'buyer@example.com');
    const mine = event('cs_mine', { client_reference_id: me.user.id, customer_details: { email: 'buyer@example.com' } });
    assert.deepEqual(await (await hook('shop', mine)).json(), { received: true, duplicate: false });
    assert.deepEqual(await (await hook('shop', mine)).json(), { received: true, duplicate: true });
    await hook('shop', event('cs_theirs', { client_reference_id: '00000000-0000-0000-0000-000000000000' }));
    const { orders } = await (await post('/shop/pay/orders', {}, { authorization: `Bearer ${tok}` })).json();
    assert.equal(orders.length, 1);
    assert.deepEqual({ ...orders[0], createdAt: undefined }, { sessionId: 'cs_mine', itemId: 'pro', quantity: 2, amountCents: 3998, currency: 'usd', status: 'paid', createdAt: undefined });
    assert.equal((await db.pool.query("select count(*)::int as n from platform.orders where session_id = 'cs_mine'")).rows[0].n, 1);
    assert.equal((await post('/shop/pay/orders', {})).status, 401);
    for (const h of [`Bearer ${tok} trailing`, `Basic x Bearer ${tok}`, `bearer ${tok}`, `Bearer`]) assert.equal((await post('/shop/pay/orders', {}, { authorization: h })).status, 401, h);
    const other = await signIn('shop2', 'buyer@example.com');
    assert.equal((await post('/shop/pay/orders', {}, { authorization: `Bearer ${other}` })).status, 401, 'a token for another app does not work');
});

t('orders never leak across apps even when the client reference id is the same', async () => {
    const tok = await signIn('shop', 'iso@example.com');
    const me = await (await post('/shop/auth/me', {}, { authorization: `Bearer ${tok}` })).json();
    const b = event('cs_iso_other', { client_reference_id: me.user.id, metadata: { vibe_app: 'shop2', vibe_item: 'pro', vibe_qty: '1' } });
    await hook('shop2', b, sign(b, WH + '2'));
    await hook('shop', event('cs_iso_mine', { client_reference_id: me.user.id }));
    const { orders } = await (await post('/shop/pay/orders', {}, { authorization: `Bearer ${tok}` })).json();
    assert.deepEqual(orders.map((o) => o.sessionId), ['cs_iso_mine']);
});

t('orders are newest first', async () => {
    const tok = await signIn('shop', 'order@example.com');
    const me = await (await post('/shop/auth/me', {}, { authorization: `Bearer ${tok}` })).json();
    for (const id of ['cs_o1', 'cs_o2', 'cs_o3']) { await hook('shop', event(id, { client_reference_id: me.user.id })); await new Promise((r) => setTimeout(r, 5)); }
    const { orders } = await (await post('/shop/pay/orders', {}, { authorization: `Bearer ${tok}` })).json();
    assert.deepEqual(orders.map((o) => o.sessionId), ['cs_o3', 'cs_o2', 'cs_o1']);
});

t('webhook: bad or missing signature and wrong-app secret record nothing; oversize body is 413; GET is 405', async () => {
    const raw = event('cs_bad');
    assert.equal((await hook('shop', raw, 'garbage')).status, 400);
    assert.equal((await post('/shop/pay/webhook', raw)).status, 400);
    assert.equal((await hook('shop', raw, sign(raw, WH + '2'))).status, 400);
    const big = event('cs_big', { pad: 'x'.repeat(70_000) });
    assert.equal((await hook('shop', big)).status, 413);
    assert.equal((await fetch(`${base()}/shop/pay/webhook`, { method: 'GET' })).status, 405);
    assert.equal((await hook('bare', raw)).status, 503);
    assert.equal((await db.pool.query("select count(*)::int as n from platform.orders where session_id in ('cs_bad','cs_big')")).rows[0].n, 0);
});

t('webhook body size: 40KB is accepted; 70KB is refused even when sent chunked with no content-length', async () => {
    const ok = event('cs_40k', { pad: 'x'.repeat(40_000) });
    assert.equal((await hook('shop', ok)).status, 200);
    const big = event('cs_70k', { pad: 'x'.repeat(70_000) });
    const r = await fetch(`${base()}/shop/pay/webhook`, { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/json', 'stripe-signature': sign(big), ...ipHdr() }, body: new ReadableStream({ start(c) { c.enqueue(Buffer.from(big.slice(0, 35_000))); c.enqueue(Buffer.from(big.slice(35_000))); c.close(); } }) });
    assert.equal(r.status, 413);
    assert.equal((await db.pool.query("select count(*)::int as n from platform.orders where session_id = 'cs_70k'")).rows[0].n, 0);
});

t('webhook has no CORS and ignores Origin (called by Stripe, not browsers)', async () => {
    const raw = event('cs_origin');
    const r = await hook('shop', raw, sign(raw), { origin: 'https://evil.example' });
    assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), null);
});

t('two apps may record the same Stripe session id independently', async () => {
    const a = event('cs_same'), b = event('cs_same', { metadata: { vibe_app: 'shop2', vibe_item: 'pro', vibe_qty: '1' } });
    assert.equal((await (await hook('shop', a)).json()).duplicate, false);
    assert.equal((await (await hook('shop2', b, sign(b, WH + '2'))).json()).duplicate, false);
});

t('concurrent deliveries of one event record exactly one order', async () => {
    const raw = event('cs_race');
    const rs = await Promise.all(Array.from({ length: 8 }, () => hook('shop', raw)));
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal((await db.pool.query("select count(*)::int as n from platform.orders where session_id = 'cs_race'")).rows[0].n, 1);
});

t('the vault stores the key encrypted: the database never contains it in plaintext', async () => {
    const { rows } = await db.pool.query("select ciphertext from platform.app_secrets where app_id = 'shop' and name = 'STRIPE_SECRET_KEY'");
    assert.ok(!Buffer.from(rows[0].ciphertext).includes(Buffer.from(SK)));
});

t('a manifest with an invalid catalog cannot be stored', async () => {
    await assert.rejects(() => stores.setManifest('shop', { pay: { catalog: [{ id: 'x', name: 'x', amountCents: 1, currency: 'usd', mode: 'payment' }] } }), /invalid manifest/);
    await assert.rejects(() => stores.upsertApp({ appId: 'bad-pay', manifest: { pay: { catalog: [] } } }), /invalid manifest/);
});

t('orders table constraints reject bad rows and the table is unique per (app, session)', async () => {
    const ins = (o) => db.pool.query("insert into platform.orders (app_id, session_id, item_id, quantity, amount_cents, currency, status) values ($1, $2, 'pro', $3, $4, $5, $6)", [o.app ?? 'shop', o.sid ?? 'cs_c', o.q ?? 1, o.amt ?? 5, o.cur ?? 'usd', o.st ?? 'paid']);
    await ins({ sid: 'cs_c' });
    await assert.rejects(() => ins({ sid: 'cs_c' }), /unique/);
    await assert.rejects(() => ins({ sid: 'cs_c1', q: 0 }), /check/);
    await assert.rejects(() => ins({ sid: 'cs_c2', amt: -1 }), /check/);
    await assert.rejects(() => ins({ sid: 'cs_c3', cur: 'USD' }), /check/);
    await assert.rejects(() => ins({ sid: 'cs_c4', st: 'refunded' }), /check/);
    await assert.rejects(() => ins({ sid: 'cs_c5', app: 'ghost' }), /foreign key/);
});
