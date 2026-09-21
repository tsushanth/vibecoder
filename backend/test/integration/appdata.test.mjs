import './../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
const { createAppDataRouter, LIMITS, BASE_DOMAIN } = await import('../../routes/appdata.routes.js');

// In-memory store mirroring the SQL function's quota semantics.
function memStore() {
    const m = new Map();
    const k = (a, c, key) => `${a}\u0000${c}\u0000${key}`;
    return {
        m,
        async get(a, c, key) { const r = m.get(k(a, c, key)); return r ? { value: r.value, updatedAt: 't' } : null; },
        async put(a, c, key, value, size) {
            const mine = [...m.entries()].filter(([x]) => x.startsWith(a + '\u0000'));
            const existing = m.get(k(a, c, key));
            if (!existing && mine.length >= LIMITS.maxKeysPerApp) return 'max_keys';
            const total = mine.reduce((s, [, r]) => s + r.size, 0) - (existing?.size || 0) + size;
            if (total > LIMITS.maxTotalBytes) return 'max_total';
            m.set(k(a, c, key), { value, size }); return 'ok';
        },
        async remove(a, c, key) { m.delete(k(a, c, key)); },
        async list(a, c, { prefix, limit, after }) {
            return [...m.entries()].filter(([x]) => x.startsWith(`${a}\u0000${c}\u0000`))
                .map(([x, r]) => ({ key: x.split('\u0000')[2], value: r.value, updatedAt: 't' }))
                .filter((r) => (!prefix || r.key.startsWith(prefix)) && (!after || r.key > after))
                .sort((x, y) => (x.key < y.key ? -1 : 1)).slice(0, limit + 1);
        },
        async collectionExists(a, c) { return [...m.keys()].some((x) => x.startsWith(`${a}\u0000${c}\u0000`)); },
        async collectionCount(a) { return new Set([...m.keys()].filter((x) => x.startsWith(a + '\u0000')).map((x) => x.split('\u0000')[1])).size; },
    };
}

const APP = 'demo-app';
const ORIGIN = `https://${APP}.${BASE_DOMAIN}`;
let srv, store, failing = null, limiterFn;
const H = (extra = {}) => ({ Origin: ORIGIN, ...extra });
const put = (path, value, headers = {}) => fetch(`${srv.base}/api/appdata/${APP}/${path}`, {
    method: 'PUT', headers: H({ 'Content-Type': 'application/json', ...headers }), body: JSON.stringify({ value }) });
const get = (path, headers = H()) => fetch(`${srv.base}/api/appdata/${APP}/${path}`, { headers });

before(async () => {
    store = memStore();
    const wrapped = new Proxy(store, { get: (t, p) => (typeof t[p] === 'function' ? (...a) => { if (failing) throw failing; return t[p](...a); } : t[p]) });
    const app = express();
    limiterFn = undefined;
    app.use('/api/appdata', createAppDataRouter({
        store: wrapped,
        allowedOrigins: async (id) => (id === APP ? new Set([ORIGIN, 'https://custom.example.com']) : null),
    }));
    srv = await listen(app);
});
after(() => srv.close());

test('PUT then GET round trip, list, overwrite, DELETE, 404', async () => {
    assert.equal((await put('todos/a1', { t: 'x' })).status, 200);
    assert.equal((await put('todos/a2', [1, 2])).status, 200);
    const g = await get('todos/a1');
    assert.equal(g.status, 200);
    assert.deepEqual((await g.json()).value, { t: 'x' });
    const l = await (await get('todos')).json();
    assert.deepEqual(l.items.map((i) => i.key), ['a1', 'a2']); assert.equal(l.next, null);
    await put('todos/a1', 'new');
    assert.equal((await (await get('todos/a1')).json()).value, 'new');
    const d = await fetch(`${srv.base}/api/appdata/${APP}/todos/a1`.replace('/todos/a1', '/todos/a1'), { method: 'DELETE', headers: H() });
    assert.equal(d.status, 200);
    assert.equal((await get('todos/a1')).status, 404);
});

test('list: prefix, limit + cursor pagination, clamp, invalid params', async () => {
    for (let i = 0; i < 5; i++) await put(`pg/k${i}`, i);
    await put('pg/z1', 'z');
    const p1 = await (await get('pg?limit=2')).json();
    assert.deepEqual(p1.items.map((i) => i.key), ['k0', 'k1']); assert.equal(p1.next, 'k1');
    const p2 = await (await get(`pg?limit=2&after=${p1.next}`)).json();
    assert.deepEqual(p2.items.map((i) => i.key), ['k2', 'k3']);
    assert.deepEqual((await (await get('pg?prefix=z')).json()).items.map((i) => i.key), ['z1']);
    assert.equal((await get('pg?limit=abc')).status, 200);
    assert.equal((await get('pg?prefix=a/b')).status, 400);
    assert.equal((await get('pg?after=..')).status, 400);
});

test('CORS: allowed origin echoed, preflight 204, custom domain ok, others 403', async () => {
    const pre = await fetch(`${srv.base}/api/appdata/${APP}/c/k`, { method: 'OPTIONS', headers: H({ 'Access-Control-Request-Method': 'PUT' }) });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
    assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
    assert.equal(pre.headers.get('vary'), 'Origin');
    const ok = await get('c/none', { Origin: 'https://custom.example.com' });
    assert.equal(ok.status, 404); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://custom.example.com');
    for (const o of ['https://evil.com', `https://${APP}.${BASE_DOMAIN}.evil.com`, `http://${APP}.${BASE_DOMAIN}`, 'null', `https://other.${BASE_DOMAIN}`]) {
        const r = await get('c/k', { Origin: o }); assert.equal(r.status, 403, o);
        assert.equal(r.headers.get('access-control-allow-origin'), null);
    }
    assert.equal((await get('c/k', {})).status, 403, 'missing Origin');
    assert.equal((await get('c/k', { Origin: ORIGIN.toUpperCase() })).status, 404, 'origin match is case-insensitive');
});

test('unknown app 404, invalid app id 400, sdk.js served without origin', async () => {
    assert.equal((await fetch(`${srv.base}/api/appdata/ghost-app/c/k`, { headers: H() })).status, 404);
    assert.equal((await fetch(`${srv.base}/api/appdata/A/c/k`, { headers: H() })).status, 400);
    const sdk = await fetch(`${srv.base}/api/appdata/sdk.js`);
    assert.equal(sdk.status, 200); assert.match(sdk.headers.get('content-type'), /javascript/);
});

test('validation details', async () => {
    assert.equal((await put('bad.coll/k', 1)).status, 400);
    assert.equal((await put('c/bad key', 1)).status, 400);
    const raw = (body, ct = 'application/json') => fetch(`${srv.base}/api/appdata/${APP}/c/k`, { method: 'PUT', headers: H({ 'Content-Type': ct }), body });
    assert.equal((await raw('{"nope":1}')).status, 400);
    assert.equal((await raw('[1,2]')).status, 400);
    assert.equal((await raw('"str"')).status, 400, 'strict JSON: top-level string rejected');
    assert.equal((await raw('{bad')).status, 400);
    assert.equal((await raw('{"value":1}', 'text/plain')).status, 415);
    assert.equal((await raw('value=1', 'application/x-www-form-urlencoded')).status, 415);
    assert.equal((await fetch(`${srv.base}/api/appdata/${APP}/c/k`, { method: 'PUT', headers: H() })).status, 415, 'no content-type');
    assert.equal((await put('c/k', 'x'.repeat(LIMITS.maxValueBytes))).status, 413);
    assert.equal((await raw(JSON.stringify({ value: 'x'.repeat(60 * 1024) }))).status, 413, 'body limit');
    assert.equal((await put('c/ok', 'x'.repeat(LIMITS.maxValueBytes - 2))).status, 200, 'exact boundary passes');
    assert.equal((await put('c/nullv', null)).status, 200);
});

test('quotas: max keys, max collections (existing collection still writable)', async () => {
    const s2 = memStore();
    const app = express();
    app.use('/api/appdata', createAppDataRouter({ store: s2, allowedOrigins: async () => new Set([ORIGIN]), rateLimit: () => 0 }));
    const srv2 = await listen(app);
    const p = (path, v) => fetch(`${srv2.base}/api/appdata/${APP}/${path}`, { method: 'PUT', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ value: v }) });
    try {
        for (let i = 0; i < LIMITS.maxCollectionsPerApp; i++) assert.equal((await p(`col${i}/k`, i)).status, 200);
        const r = await p('one-too-many/k', 1);
        assert.equal(r.status, 413); assert.match((await r.json()).error, /collections/);
        assert.equal((await p('col0/k2', 1)).status, 200);
        const big = 'y'.repeat(30000);
        s2.m.clear();
        for (let i = 0; i < 1000; i++) s2.m.set(`${APP}\u0000col0\u0000f${i}`, { value: 1, size: 1 });
        const full = await p('col0/new', 1);
        assert.equal(full.status, 413); assert.match((await full.json()).error, /key quota/);
        assert.equal((await p('col0/f5', 2)).status, 200, 'overwrite of existing key allowed at quota');
        s2.m.clear();
        for (let i = 0; i < 175; i++) s2.m.set(`${APP}\u0000col0\u0000b${i}`, { value: 1, size: 30000 });
        const tot = await p('col0/x', big);
        assert.equal(tot.status, 413); assert.match((await tot.json()).error, /storage quota/);
    } finally { await srv2.close(); }
});

test('rate limit: 429 + Retry-After after writesPerMinPerIpApp; reads limited separately', async () => {
    const app = express();
    app.use('/api/appdata', createAppDataRouter({ store: memStore(), allowedOrigins: async () => new Set([ORIGIN]) }));
    const s = await listen(app);
    try {
        const w = () => fetch(`${s.base}/api/appdata/${APP}/c/k`, { method: 'PUT', headers: H({ 'Content-Type': 'application/json' }), body: '{"value":1}' });
        for (let i = 0; i < LIMITS.writesPerMinPerIpApp; i++) assert.equal((await w()).status, 200);
        const r = await w();
        assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) >= 1);
        assert.equal((await fetch(`${s.base}/api/appdata/${APP}/c/k`, { headers: H() })).status, 200, 'reads unaffected by write limit');
        // DELETE counts as a write too
        assert.equal((await fetch(`${s.base}/api/appdata/${APP}/c/k`, { method: 'DELETE', headers: H() })).status, 429);
    } finally { await s.close(); }
});

test('rate limiting is applied before origin-independent work: 403 responses are not rate limited (documented)', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await get('c/k', { Origin: 'https://evil.com' })).status, 403);
});

test('503 when storage tables missing; 500 (no leak) on other errors', async () => {
    const quiet = console.error; console.error = () => {};
    try {
        failing = { code: 'PGRST205', message: 'Could not find the table in the schema cache' };
        assert.equal((await get('c/k')).status, 503);
        failing = { code: 'XX', message: 'password authentication failed for user secret' };
        const r = await get('c/k');
        assert.equal(r.status, 500);
        assert.doesNotMatch(JSON.stringify(await r.json()), /password|secret/);
        failing = new Error('boom');
        assert.equal((await put('c/k', 1)).status, 500);
    } finally { failing = null; console.error = quiet; }
});
