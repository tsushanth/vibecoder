import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SNIPPET = /\/\* BEGIN vibe\.pay \*\/([\s\S]*?)\/\* END vibe\.pay \*\//.exec(read('../sdk-snippet.js'))[1];
const VIBE = read('../../sdk/vibe.js');

// Splice exactly as documented in sdk-snippet.js: block before `window.vibe = {`, and `pay: pay` in the exported object.
function spliced() {
    const marker = /^(\s*)window\.vibe = \{/m;
    assert.ok(marker.test(VIBE), 'vibe.js must still export through `window.vibe = {`');
    return VIBE.replace(marker, (m) => `${SNIPPET}\n${m} pay: pay,`);
}
const SRC = spliced();

function load({ host = 'myapp.vibebuild.cc', win = {}, reply } = {}) {
    const calls = []; const assigned = [];
    const ctx = {
        location: { hostname: host, assign: (u) => assigned.push(u) },
        fetch: async (url, init) => {
            calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
            if (reply === 'network') throw new TypeError('Failed to fetch');
            if (typeof reply === 'function') return reply(url, init);
            return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_1', mode: 'test' }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
        AbortController, setTimeout, clearTimeout, JSON, Promise, Error, encodeURIComponent, Object, Array, Number, String, Math, RegExp, URLSearchParams,
    };
    ctx.window = ctx;
    Object.assign(ctx, { VIBE_BASE: 'https://proxy.test', ...win });
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return { vibe: ctx.vibe, calls, assigned, ctx };
}
const plain = (v) => JSON.parse(JSON.stringify(v)); // objects built inside the vm context have another prototype
const jsonRes = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const store = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };

test('the snippet is ES5: no arrow functions, let/const, template strings or async', () => {
    assert.doesNotMatch(SNIPPET, /=>|\blet\b|\bconst\b|`|\basync\b|\bawait\b|\.\.\./);
});

test('vibe.pay exposes exactly checkout and orders, and the other APIs are untouched', () => {
    const { vibe } = load();
    assert.deepEqual(Object.keys(vibe.pay).sort(), ['checkout', 'orders']);
    assert.deepEqual(Object.keys(vibe).sort(), ['ai', 'api', 'auth', 'db', 'pay', 'version']);
});

test('checkout posts only the item id and quantity to /<app>/pay/checkout and redirects', async () => {
    const { vibe, calls, assigned } = load();
    const r = await vibe.pay.checkout({ item: 'pro', quantity: 2, price: 1, amountCents: 1, currency: 'eur', name: 'x' });
    assert.deepEqual(plain(r), { url: 'https://checkout.stripe.com/c/pay/cs_1', mode: 'test' });
    assert.equal(calls[0].url, 'https://proxy.test/myapp/pay/checkout');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].body, { item: 'pro', quantity: 2 });
    assert.deepEqual(assigned, ['https://checkout.stripe.com/c/pay/cs_1']);
});

test('quantity defaults to 1; successPath and cancelPath are passed through', async () => {
    const { vibe, calls } = load();
    await vibe.pay.checkout({ item: 'pro', successPath: '/thanks', cancelPath: '/cart' });
    assert.deepEqual(calls[0].body, { item: 'pro', quantity: 1, successPath: '/thanks', cancelPath: '/cart' });
});

test('redirect:false returns the url without navigating', async () => {
    const { vibe, assigned } = load();
    assert.equal((await vibe.pay.checkout({ item: 'pro', redirect: false })).url, 'https://checkout.stripe.com/c/pay/cs_1');
    assert.deepEqual(assigned, []);
});

test('a session token is sent as a bearer when signed in, and omitted when not', async () => {
    const { vibe, calls } = load({ win: { localStorage: store({ 'vibe:session:myapp': 'tok123' }) } });
    await vibe.pay.checkout({ item: 'pro', redirect: false });
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok123');
    const anon = load();
    await anon.vibe.pay.checkout({ item: 'pro', redirect: false });
    assert.equal(anon.calls[0].init.headers.Authorization, undefined);
});

test('bad arguments reject locally with bad_request and never hit the network', async () => {
    const { vibe, calls } = load();
    for (const o of [undefined, {}, { item: '' }, { item: 5 }, { item: 'a', quantity: 0 }, { item: 'a', quantity: 1.5 }, { item: 'a', quantity: '2' }, { item: 'a', quantity: -1 }, { item: 'a', quantity: NaN }]) {
        await assert.rejects(() => vibe.pay.checkout(o), (e) => e.code === 'bad_request' && e.status === 0, JSON.stringify(o));
    }
    assert.equal(calls.length, 0);
});

test('a response URL that is not Stripe Checkout is refused and never navigated to', async () => {
    for (const url of ['https://evil.example/x', 'http://checkout.stripe.com/x', 'https://checkout.stripe.com.evil.example/', 'javascript:alert(1)', undefined, 5]) {
        const { vibe, assigned } = load({ reply: () => jsonRes(200, { url, mode: 'live' }) });
        await assert.rejects(() => vibe.pay.checkout({ item: 'pro' }), (e) => e.code === 'bad_response');
        assert.deepEqual(assigned, []);
    }
});

test('server errors surface as Error with status and short code; retry-after is carried', async () => {
    const { vibe } = load({ reply: () => new Response(JSON.stringify({ error: 'pay_rate_limited_ip' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '120' } }) });
    await assert.rejects(() => vibe.pay.checkout({ item: 'pro' }), (e) => e.status === 429 && e.code === 'pay_rate_limited_ip' && e.retryAfter === 120);
    const net = load({ reply: 'network' });
    await assert.rejects(() => net.vibe.pay.checkout({ item: 'pro' }), (e) => e.code === 'network');
});

test('orders needs a session: signed out rejects 401 locally, signed in posts with the bearer and returns the list', async () => {
    const out = load();
    await assert.rejects(() => out.vibe.pay.orders(), (e) => e.status === 401 && e.code === 'unauthorized');
    assert.equal(out.calls.length, 0);
    const list = [{ sessionId: 'cs_1', itemId: 'pro', quantity: 1, amountCents: 1999, currency: 'usd', status: 'paid', createdAt: '2026-10-05T00:00:00Z' }];
    const { vibe, calls } = load({ win: { localStorage: store({ 'vibe:session:myapp': 'tok123' }) }, reply: () => jsonRes(200, { orders: list }) });
    assert.deepEqual(plain(await vibe.pay.orders()), list);
    assert.equal(calls[0].url, 'https://proxy.test/myapp/pay/orders');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok123');
    assert.deepEqual(calls[0].body, {});
});

test('on a custom domain the app id comes from VIBE_APP_ID', async () => {
    const { vibe, calls } = load({ host: 'shop.example.com', win: { VIBE_APP_ID: 'shop' } });
    await vibe.pay.checkout({ item: 'pro', redirect: false });
    assert.equal(calls[0].url, 'https://proxy.test/shop/pay/checkout');
});
