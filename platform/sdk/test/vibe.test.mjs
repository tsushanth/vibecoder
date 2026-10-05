import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../vibe.js', import.meta.url)), 'utf8');

function load({ host = 'myapp.vibebuild.cc', win = {}, reply } = {}) {
    const calls = [];
    const ctx = {
        location: { hostname: host },
        fetch: async (url, init) => {
            calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
            if (reply === 'network') throw new TypeError('Failed to fetch');
            if (typeof reply === 'function') return reply(url, init);
            return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
        AbortController, setTimeout, clearTimeout, JSON, Promise, Error, encodeURIComponent, Object, Array, Number, String, URLSearchParams,
    };
    ctx.window = ctx;
    Object.assign(ctx, { VIBE_BASE: 'https://proxy.test', ...win });
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return { vibe: ctx.vibe, calls, ctx };
}
const jsonRes = (status, obj, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

test('exposes only api, ai and version', () => {
    assert.deepEqual(Object.keys(load().vibe).sort(), ['ai', 'api', 'auth', 'version']);
    assert.deepEqual(Object.keys(load().vibe.ai).sort(), ['ask', 'chat']);
});

test('api posts the connector call to the app proxy endpoint and returns parsed JSON', async () => {
    const { vibe, calls } = load();
    const r = await vibe.api('nws', '/points/39,-97', { query: { a: '1' } });
    assert.deepEqual(r, { ok: 1 });
    assert.equal(calls[0].url, 'https://proxy.test/myapp/api');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].body, { connector: 'nws', method: 'GET', path: '/points/39,-97', query: { a: '1' } });
});

test('api passes method and body through', async () => {
    const { vibe, calls } = load();
    await vibe.api('hook', '/x', { method: 'post', body: { a: 1 } });
    assert.deepEqual(calls[0].body, { connector: 'hook', method: 'POST', path: '/x', body: { a: 1 } });
});

test('api never sends caller-supplied credentials or headers, only content-type', async () => {
    const { vibe, calls } = load();
    await vibe.api('hook', '/x', { headers: { authorization: 'Bearer abc' }, apiKey: 'sk-live', body: {} });
    assert.deepEqual(Object.keys(calls[0].init.headers), ['Content-Type']);
    assert.equal(JSON.stringify(calls[0].body).includes('sk-live'), false);
    assert.equal(Object.hasOwn(calls[0].body, 'headers'), false);
});

test('app id comes from the host, or from window.VIBE_APP_ID for custom domains', async () => {
    const a = load({ host: 'cool-game.vibebuild.cc' });
    await a.vibe.api('nws', '/points/1,1');
    assert.equal(a.calls[0].url, 'https://proxy.test/cool-game/api');
    const b = load({ host: 'example.com', win: { VIBE_APP_ID: 'custom1' } });
    await b.vibe.api('nws', '/points/1,1');
    assert.equal(b.calls[0].url, 'https://proxy.test/custom1/api');
});

test('an unknown app id rejects the promise and makes no request', async () => {
    const { vibe, calls } = load({ host: 'example.com' });
    await assert.rejects(() => vibe.api('nws', '/x'), /app id/i);
    assert.equal(calls.length, 0);
});

test('a non-JSON response resolves as text', async () => {
    const { vibe } = load({ reply: async () => new Response('plain', { status: 200, headers: { 'content-type': 'text/plain' } }) });
    assert.equal(await vibe.api('nws', '/x'), 'plain');
});

test('an error response rejects with status, code and retryAfter', async () => {
    const { vibe } = load({ reply: async () => jsonRes(429, { error: 'rate_limited_ip' }, { 'retry-after': '12' }) });
    await assert.rejects(() => vibe.api('nws', '/x'), (e) => e instanceof Error && e.status === 429 && e.code === 'rate_limited_ip' && e.retryAfter === 12);
});

test('a network failure rejects with status 0 and code network', async () => {
    const { vibe } = load({ reply: 'network' });
    await assert.rejects(() => vibe.api('nws', '/x'), (e) => e.status === 0 && e.code === 'network');
});

test('a slow response rejects with code timeout', async () => {
    const { vibe } = load({ win: { VIBE_TIMEOUT_MS: 30 }, reply: (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))) });
    await assert.rejects(() => vibe.api('nws', '/x'), (e) => e.code === 'timeout');
});

test('ai.chat posts messages and options to the ai endpoint and returns text and usage', async () => {
    const { vibe, calls } = load({ reply: async () => jsonRes(200, { text: 'hi', usage: { promptTokens: 1, completionTokens: 2 } }) });
    const r = await vibe.ai.chat([{ role: 'user', content: 'yo' }], { maxTokens: 50, temperature: 0.3 });
    assert.deepEqual(r, { text: 'hi', usage: { promptTokens: 1, completionTokens: 2 } });
    assert.equal(calls[0].url, 'https://proxy.test/myapp/ai');
    assert.deepEqual(calls[0].body, { messages: [{ role: 'user', content: 'yo' }], maxTokens: 50, temperature: 0.3 });
});

test('ai.chat does not let the app pick a model or send keys', async () => {
    const { vibe, calls } = load({ reply: async () => jsonRes(200, { text: 'x', usage: {} }) });
    await vibe.ai.chat([{ role: 'user', content: 'yo' }], { model: 'anthropic/claude-opus-5-5', apiKey: 'sk-x' });
    assert.deepEqual(Object.keys(calls[0].body), ['messages']);
});

test('ai.ask sends an optional system message plus the prompt and resolves the text', async () => {
    const { vibe, calls } = load({ reply: async () => jsonRes(200, { text: 'answer', usage: {} }) });
    assert.equal(await vibe.ai.ask('why?', { system: 'be brief' }), 'answer');
    assert.deepEqual(calls[0].body.messages, [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'why?' }]);
});

test('ai.chat rejects bad input locally without a request', async () => {
    const { vibe, calls } = load();
    await assert.rejects(() => vibe.ai.chat([]), /messages/i);
    await assert.rejects(() => vibe.ai.chat('hi'), /messages/i);
    await assert.rejects(() => vibe.ai.ask(''), /prompt/i);
    assert.equal(calls.length, 0);
});

test('the SDK source embeds no credentials and no hostname other than the configurable default base', () => {
    assert.equal(/sk-|AIza|ghp_|AKIA/.test(SRC), false);
    const hosts = [...SRC.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
    assert.ok(hosts.every((h) => h === 'vibe-proxy.vibebuild.cc'), hosts.join(','));
});

// ---- vibe.auth ----------------------------------------------------------------
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const LINK = 'L'.repeat(43);
const loadAuth = ({ search = '', ls = store(), reply } = {}) => {
    const hist = [];
    const l = load({ win: { localStorage: ls, history: { replaceState: (...a) => hist.push(a) } }, reply });
    return { ...l, ls, hist };
};
const loadWithLocation = ({ search = '', ls = store(), reply } = {}) => {
    const hist = []; const calls = [];
    const ctx = {
        location: { hostname: 'myapp.vibebuild.cc', search, pathname: '/play', hash: '#h' },
        fetch: async (url, init) => { calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined }); return reply(url, init, calls.length); },
        AbortController, setTimeout, clearTimeout, JSON, Promise, Error, encodeURIComponent, Object, Array, Number, String, URLSearchParams,
        localStorage: ls, history: { replaceState: (...a) => hist.push(a) }, VIBE_BASE: 'https://proxy.test',
    };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
    return { vibe: ctx.vibe, calls, hist, ls };
};

test('auth.signIn posts the email and rejects bad input without a request', async () => {
    const { vibe, calls } = loadAuth();
    await vibe.auth.signIn('  a@b.com ');
    assert.equal(calls[0].url, 'https://proxy.test/myapp/auth/request'); assert.deepEqual(calls[0].body, { email: 'a@b.com' });
    for (const bad of ['', '  ', undefined, 5]) await assert.rejects(() => vibe.auth.signIn(bad), (e) => e.code === 'bad_request');
    assert.equal(calls.length, 1);
});

test('auth.user is null without a session and makes no request', async () => {
    const { vibe, calls } = loadAuth();
    assert.equal(await vibe.auth.user(), null); assert.equal(calls.length, 0);
});

test('auth.user sends the stored token as a bearer and returns the user; a 401 clears the session', async () => {
    const ls = store(); ls.setItem('vibe:session:myapp', 'tok-1');
    let status = 200;
    const { vibe, calls } = loadAuth({ ls, reply: () => jsonRes(status, status === 200 ? { user: { id: 'u1', email: 'a@b.com' } } : { error: 'unauthorized' }) });
    assert.deepEqual(await vibe.auth.user(), { id: 'u1', email: 'a@b.com' });
    assert.equal(calls[0].url, 'https://proxy.test/myapp/auth/me'); assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-1');
    status = 401;
    assert.equal(await vibe.auth.user(), null); assert.equal(ls.getItem('vibe:session:myapp'), null);
});

test('auth.user rethrows non-401 errors and keeps the session', async () => {
    const ls = store(); ls.setItem('vibe:session:myapp', 'tok-1');
    const { vibe } = loadAuth({ ls, reply: () => jsonRes(503, { error: 'auth_unavailable' }) });
    await assert.rejects(() => vibe.auth.user(), (e) => e.status === 503);
    assert.equal(ls.getItem('vibe:session:myapp'), 'tok-1');
});

test('auth.signOut clears the session, tells the server, notifies, and never fails', async () => {
    const ls = store(); ls.setItem('vibe:session:myapp', 'tok-1');
    const { vibe, calls } = loadAuth({ ls, reply: () => { throw new TypeError('offline'); } });
    const seen = []; vibe.auth.onChange((u) => seen.push(u));
    assert.equal((await vibe.auth.signOut()).ok, true);
    assert.equal(ls.getItem('vibe:session:myapp'), null); assert.deepEqual(seen, [null]);
    assert.equal(calls[0].url, 'https://proxy.test/myapp/auth/signout'); assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-1');
});

test('a sign-in link in the URL is exchanged for a session, stored, announced and removed from the address bar', async () => {
    const { vibe, calls, ls, hist } = loadWithLocation({ search: `?a=1&vibe_login=${LINK}&b=2`, reply: () => jsonRes(200, { token: 'sess-9', user: { id: 'u9', email: 'z@z.com' } }) });
    const seen = []; vibe.auth.onChange((u) => seen.push(u));
    assert.deepEqual(await vibe.auth.ready, { id: 'u9', email: 'z@z.com' });
    assert.equal(calls[0].url, 'https://proxy.test/myapp/auth/consume'); assert.deepEqual(calls[0].body, { token: LINK });
    assert.equal(ls.getItem('vibe:session:myapp'), 'sess-9');
    assert.equal(hist.length, 1); assert.equal(hist[0][2], '/play?a=1&b=2#h'); assert.equal(hist[0][2].includes(LINK), false);
});

test('a bad or used link resolves ready with null, stores nothing, and still cleans the URL', async () => {
    const { vibe, ls, hist } = loadWithLocation({ search: `?vibe_login=${LINK}`, reply: () => jsonRes(400, { error: 'invalid_link' }) });
    assert.equal(await vibe.auth.ready, null); assert.equal(ls.getItem('vibe:session:myapp'), null);
    assert.equal(hist[0][2], '/play#h');
});

test('without a link in the URL ready resolves null and no request is made; odd tokens are ignored', async () => {
    const a = loadWithLocation({ search: '?x=1', reply: () => jsonRes(200, {}) });
    assert.equal(await a.vibe.auth.ready, null); assert.equal(a.calls.length, 0);
    const b = loadWithLocation({ search: '?vibe_login=short', reply: () => jsonRes(200, {}) });
    assert.equal(await b.vibe.auth.ready, null); assert.equal(b.calls.length, 0);
});

test('blocked storage falls back to memory for the page', async () => {
    const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    const { vibe, calls } = loadWithLocation({ search: `?vibe_login=${LINK}`, ls: bad, reply: (u) => (String(u).endsWith('/consume') ? jsonRes(200, { token: 'sess-m', user: { id: 'u', email: 'e@e.com' } }) : jsonRes(200, { user: { id: 'u', email: 'e@e.com' } })) });
    await vibe.auth.ready;
    assert.equal((await vibe.auth.user()).id, 'u'); assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer sess-m');
});

test('an onChange listener can be removed and a throwing listener does not stop the others', async () => {
    const { vibe } = loadAuth();
    const seen = []; const off = vibe.auth.onChange((u) => seen.push(['a', u])); vibe.auth.onChange(() => { throw new Error('x'); }); vibe.auth.onChange((u) => seen.push(['c', u]));
    await vibe.auth.signOut(); off(); await vibe.auth.signOut();
    assert.deepEqual(seen, [['a', null], ['c', null], ['c', null]]);
    assert.equal(typeof vibe.auth.onChange('nope'), 'function');
});

test('without an app id (custom domain not configured) auth rejects with no_app_id and never fetches', async () => {
    const { vibe, calls } = load({ host: 'shop.example.com' });
    await assert.rejects(() => vibe.auth.signIn('a@b.com'), (e) => e.code === 'no_app_id'); assert.equal(calls.length, 0);
});
