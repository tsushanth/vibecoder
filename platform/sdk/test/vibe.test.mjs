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
            calls.push({ url, init, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
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

test('exposes only api, ai, auth, db and version', () => {
    assert.deepEqual(Object.keys(load().vibe).sort(), ['ai', 'api', 'auth', 'db', 'pay', 'storage', 'version']);
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
        fetch: async (url, init) => { calls.push({ url, init, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }); return reply(url, init, calls.length); },
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

// ---- vibe.db ------------------------------------------------------------------
const loadDb = ({ token, reply } = {}) => {
    const ls = store();
    if (token) ls.setItem('vibe:session:myapp', token);
    const l = load({ win: { localStorage: ls }, reply: reply || (async () => jsonRes(200, { rows: [{ id: 'r1' }] })) });
    return { ...l, ls };
};
const W = [{ col: 'id', op: 'eq', val: 'abc' }];

test('db.from(t).select() with no arguments posts a bare select to the db endpoint', async () => {
    const { vibe, calls } = loadDb();
    assert.deepEqual(await vibe.db.from('todos').select(), { rows: [{ id: 'r1' }] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://proxy.test/myapp/db');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].body, { op: 'select', table: 'todos' });
});

test('db select forwards where, order, limit, offset and columns and nothing else', async () => {
    const { vibe, calls } = loadDb();
    const opts = { where: [{ col: 'done', op: 'eq', val: false }], order: [{ col: 'created_at', dir: 'desc' }], limit: 20, offset: 40, columns: ['id', 'title'] };
    await vibe.db.from('todos').select(opts);
    assert.deepEqual(calls[0].body, { op: 'select', table: 'todos', ...opts });
    await vibe.db.from('todos').select({ limit: 0, offset: 0 });
    assert.deepEqual(calls[1].body, { op: 'select', table: 'todos', limit: 0, offset: 0 });
    await vibe.db.from('todos').select({});
    assert.deepEqual(calls[2].body, { op: 'select', table: 'todos' });
    await vibe.db.from('todos').select({ where: [] });
    assert.deepEqual(calls[3].body, { op: 'select', table: 'todos', where: [] });
    await vibe.db.from('todos').select({ order: [] });
    assert.deepEqual(calls[4].body, { op: 'select', table: 'todos', order: [] });
});

test('db insert wraps one row in an array and passes arrays through', async () => {
    const { vibe, calls } = loadDb();
    await vibe.db.from('todos').insert({ title: 'a' });
    assert.deepEqual(calls[0].body, { op: 'insert', table: 'todos', rows: [{ title: 'a' }] });
    await vibe.db.from('todos').insert([{ title: 'a' }, { title: 'b' }]);
    assert.deepEqual(calls[1].body, { op: 'insert', table: 'todos', rows: [{ title: 'a' }, { title: 'b' }] });
    await vibe.db.from('todos').insert(Array.from({ length: 50 }, () => ({ title: 'x' })));
    assert.equal(calls[2].body.rows.length, 50);
});

test('db update sends set and the required where; delete sends where', async () => {
    const { vibe, calls } = loadDb();
    await vibe.db.from('todos').update({ done: true }, W);
    assert.deepEqual(calls[0].body, { op: 'update', table: 'todos', set: { done: true }, where: W });
    await vibe.db.from('todos').delete(W);
    assert.deepEqual(calls[1].body, { op: 'delete', table: 'todos', where: W });
});

test('db calls use the table they were created with and each builder is independent', async () => {
    const { vibe, calls } = loadDb();
    const a = vibe.db.from('todos');
    const b = vibe.db.from('notes');
    await a.select(); await b.select(); await a.delete(W);
    assert.deepEqual(calls.map((c) => c.body.table), ['todos', 'notes', 'todos']);
});

test('db calls send the stored session token as a bearer, and none when signed out', async () => {
    const out = loadDb();
    await out.vibe.db.from('todos').select();
    assert.deepEqual(Object.keys(out.calls[0].init.headers), ['Content-Type']);
    const inn = loadDb({ token: 'tok-7' });
    await inn.vibe.db.from('todos').select();
    await inn.vibe.db.from('todos').insert({ a: 1 });
    await inn.vibe.db.from('todos').update({ a: 1 }, W);
    await inn.vibe.db.from('todos').delete(W);
    assert.equal(inn.calls.length, 4);
    for (const c of inn.calls) assert.equal(c.init.headers.Authorization, 'Bearer tok-7');
});

test('db picks up a token stored after load and stops sending it after sign-out', async () => {
    const { vibe, calls, ls } = loadDb();
    await vibe.db.from('todos').select();
    ls.setItem('vibe:session:myapp', 'late');
    await vibe.db.from('todos').select();
    await vibe.auth.signOut();
    await vibe.db.from('todos').select();
    const dbCalls = calls.filter((c) => c.url.endsWith('/db'));
    assert.equal(dbCalls[0].init.headers.Authorization, undefined);
    assert.equal(dbCalls[1].init.headers.Authorization, 'Bearer late');
    assert.equal(dbCalls[2].init.headers.Authorization, undefined);
});

test('db never lets the caller send a user id, headers or keys', async () => {
    const { vibe, calls } = loadDb({ token: 't' });
    await assert.rejects(() => vibe.db.from('todos').select({ user_id: 'u', headers: { a: 1 } }), (e) => e.code === 'bad_request');
    await vibe.db.from('todos').insert({ title: 'x' });
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['op', 'rows', 'table']);
    assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Authorization', 'Content-Type']);
});

test('db errors from the server reject with status, code and retryAfter', async () => {
    const { vibe } = loadDb({ reply: async () => jsonRes(403, { error: 'forbidden' }) });
    await assert.rejects(() => vibe.db.from('todos').select(), (e) => e instanceof Error && e.status === 403 && e.code === 'forbidden');
    await assert.rejects(() => vibe.db.from('todos').insert({ a: 1 }), (e) => e.status === 403);
    await assert.rejects(() => vibe.db.from('todos').update({ a: 1 }, W), (e) => e.status === 403);
    await assert.rejects(() => vibe.db.from('todos').delete(W), (e) => e.status === 403);
    const rl = loadDb({ reply: async () => jsonRes(429, { error: 'rate_limited_ip' }, { 'retry-after': '9' }) });
    await assert.rejects(() => rl.vibe.db.from('t').select(), (e) => e.status === 429 && e.code === 'rate_limited_ip' && e.retryAfter === 9);
    const net = loadDb({ reply: 'network' });
    await assert.rejects(() => net.vibe.db.from('t').select(), (e) => e.status === 0 && e.code === 'network');
});

test('db does not clear the session on 401 (only auth.user does)', async () => {
    const { vibe, ls } = loadDb({ token: 'keep', reply: async () => jsonRes(401, { error: 'unauthenticated' }) });
    await assert.rejects(() => vibe.db.from('todos').select(), (e) => e.status === 401 && e.code === 'unauthenticated');
    assert.equal(ls.getItem('vibe:session:myapp'), 'keep');
});

test('db with no app id rejects with no_app_id and never fetches', async () => {
    const { vibe, calls } = load({ host: 'shop.example.com' });
    await assert.rejects(() => vibe.db.from('todos').select(), (e) => e.code === 'no_app_id');
    assert.equal(calls.length, 0);
});

test('db rejects bad arguments locally with bad_request and makes no request', async () => {
    const { vibe, calls } = loadDb({ token: 't' });
    const t = vibe.db.from('todos');
    const cases = [
        () => vibe.db.from().select(),
        () => vibe.db.from('').select(),
        () => vibe.db.from(5).select(),
        () => vibe.db.from('Todos').select(),
        () => vibe.db.from('to-dos').select(),
        () => vibe.db.from('todos; drop').select(),
        () => vibe.db.from('1todos').select(),
        () => vibe.db.from('a'.repeat(42)).select(),
        () => vibe.db.from(null).insert({ a: 1 }),
        () => vibe.db.from('x y').update({ a: 1 }, W),
        () => vibe.db.from('x y').delete(W),
        () => t.select('where'),
        () => t.select(5),
        () => t.select([]),
        () => t.select({ filter: [] }),
        () => t.select({ where: 'x' }),
        () => t.select({ where: {} }),
        () => t.select({ where: ['x'] }),
        () => t.select({ where: [null] }),
        () => t.select({ where: [[]] }),
        () => t.select({ order: 'x' }),
        () => t.select({ order: ['title'] }),
        () => t.select({ order: [null] }),
        () => t.select({ limit: '5' }),
        () => t.select({ offset: '5' }),
        () => t.select({ columns: 'id' }),
        () => t.select({ columns: [] }),
        () => t.insert(),
        () => t.insert(null),
        () => t.insert('x'),
        () => t.insert(5),
        () => t.insert([]),
        () => t.insert(['x']),
        () => t.insert([{ a: 1 }, null]),
        () => t.insert([[]]),
        () => t.insert(Array.from({ length: 51 }, () => ({ a: 1 }))),
        () => t.update(),
        () => t.update({ a: 1 }),
        () => t.update({ a: 1 }, []),
        () => t.update({ a: 1 }, {}),
        () => t.update({ a: 1 }, 'x'),
        () => t.update({ a: 1 }, ['x']),
        () => t.update({}, W),
        () => t.update(null, W),
        () => t.update([], W),
        () => t.update('x', W),
        () => t.delete(),
        () => t.delete([]),
        () => t.delete({}),
        () => t.delete('id'),
        () => t.delete(['x']),
    ];
    for (let i = 0; i < cases.length; i++) {
        const p = cases[i]();
        assert.ok(p instanceof Promise, 'case ' + i + ' must return a Promise, not throw');
        await assert.rejects(() => p, (e) => e instanceof Error && e.code === 'bad_request' && e.status === 0, 'case ' + i);
    }
    assert.equal(calls.length, 0);
});

test('db argument errors name the problem for the app author', async () => {
    const { vibe } = loadDb();
    await assert.rejects(() => vibe.db.from('Bad').select(), /table/i);
    await assert.rejects(() => vibe.db.from('t').update({ a: 1 }, []), /where/i);
    await assert.rejects(() => vibe.db.from('t').delete([]), /where/i);
    await assert.rejects(() => vibe.db.from('t').update({}, W), /set/i);
    await assert.rejects(() => vibe.db.from('t').insert([]), /row/i);
    await assert.rejects(() => vibe.db.from('t').select({ nope: 1 }), /nope/);
    await assert.rejects(() => vibe.db.from('t').select({ limit: 'x' }), /limit/i);
    await assert.rejects(() => vibe.db.from('t').select({ offset: 'x' }), /offset/i);
    await assert.rejects(() => vibe.db.from('t').select({ columns: [] }), /columns/i);
    await assert.rejects(() => vibe.db.from('t').select({ order: 'x' }), /order/i);
    await assert.rejects(() => vibe.db.from('t').select({ where: 'x' }), /where/i);
    await assert.rejects(() => vibe.db.from('t').select('x'), /options/i);
});

test('db accepts a 41 char table name and rejects 42', async () => {
    const { vibe, calls } = loadDb();
    await vibe.db.from('a' + 'b'.repeat(40)).select();
    assert.equal(calls.length, 1);
    await assert.rejects(() => vibe.db.from('a' + 'b'.repeat(41)).select(), (e) => e.code === 'bad_request');
});

test('only db.from is exposed under vibe.db', () => {
    assert.deepEqual(Object.keys(load().vibe.db), ['from']);
    assert.deepEqual(Object.keys(load().vibe.db.from('t')).sort(), ['delete', 'insert', 'select', 'update']);
});

test('db insert of an empty row is allowed (all defaults) and is sent as one row', async () => {
    const { vibe, calls } = loadDb();
    await vibe.db.from('todos').insert({});
    assert.deepEqual(calls[0].body, { op: 'insert', table: 'todos', rows: [{}] });
});

// ---- vibe.storage ----------------------------------------------------------------
const signedIn = (reply) => { const ls = store(); ls.setItem('vibe:session:myapp', 'tok-s'); return loadAuth({ ls, reply }); };
const fileLike = (o = {}) => ({ size: 100, type: 'image/png', name: 'a b.png', ...o });
const rawOk = (obj) => () => jsonRes(200, obj);

test('storage.upload posts the file itself with its type, name and the bearer, and returns the file record', async () => {
    const { vibe, calls } = signedIn(rawOk({ file: { id: 'f1', name: 'a b.png' } }));
    const f = fileLike();
    const r = await vibe.storage.upload(f, { public: true });
    assert.equal(r.id, 'f1');
    assert.equal(calls[0].url, 'https://proxy.test/myapp/storage/upload?name=a%20b.png&public=1');
    assert.equal(calls[0].init.headers['Content-Type'], 'image/png'); assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-s'); assert.equal(calls[0].init.body, f);
    await vibe.storage.upload(fileLike({ name: undefined })); assert.equal(calls[1].url, 'https://proxy.test/myapp/storage/upload?name=file');
});

test('storage.upload refuses bad files and a signed-out user without any request', async () => {
    const { vibe, calls } = signedIn(rawOk({ file: {} }));
    for (const bad of [null, undefined, 'x', {}, fileLike({ type: '' }), fileLike({ size: 0 }), fileLike({ size: 5 * 1024 * 1024 + 1 }), fileLike({ size: '5' })]) await assert.rejects(() => vibe.storage.upload(bad), (e) => e.code === 'bad_request');
    assert.equal(calls.length, 0);
    const out = loadAuth({ reply: rawOk({}) });
    await assert.rejects(() => out.vibe.storage.upload(fileLike()), (e) => e.status === 401); await assert.rejects(() => out.vibe.storage.list(), (e) => e.status === 401);
    assert.equal(out.calls.length, 0);
    assert.equal((await signedIn(rawOk({ file: {} })).vibe.storage.upload(fileLike({ size: 5 * 1024 * 1024 }))) !== undefined, true);
});

test('storage.list, url and remove post the right bodies and unwrap results', async () => {
    const { vibe, calls } = signedIn((u) => jsonRes(200, String(u).endsWith('/list') ? { files: [{ id: 'f1' }] } : String(u).endsWith('/url') ? { url: 'https://r2.test/x', expiresInSec: 300 } : { ok: true }));
    assert.equal((await vibe.storage.list())[0].id, 'f1');
    assert.equal(await vibe.storage.url('f1'), 'https://r2.test/x'); assert.deepEqual(calls[1].body, { id: 'f1' }); assert.equal(calls[1].init.headers.Authorization, 'Bearer tok-s');
    assert.equal((await vibe.storage.remove('f1')).ok, true); assert.equal(calls[2].url, 'https://proxy.test/myapp/storage/delete'); assert.deepEqual(calls[2].body, { id: 'f1' });
    const n = calls.length;
    for (const bad of [undefined, '', 5]) { await assert.rejects(() => vibe.storage.url(bad), (e) => e.code === 'bad_request'); await assert.rejects(() => vibe.storage.remove(bad), (e) => e.code === 'bad_request'); }
    assert.equal(calls.length, n);
});

test('storage errors from the server propagate with status and code', async () => {
    const { vibe } = signedIn(() => jsonRes(415, { error: 'type_not_allowed' }));
    await assert.rejects(() => vibe.storage.upload(fileLike()), (e) => e.status === 415 && e.code === 'type_not_allowed');
});
