import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../server.js';
import { createLimiter, memoryStore } from '../../vibe-proxy/limits.js';
import { createMeter } from '../../vibe-proxy/meter.js';

const SECRET = 'S3cr3tValueXYZ';
const OR_KEY = 'sk-or-v1-FAKEFORTESTS0123456789abcdef';
const APPS = {
    app1: { enabled: true, domains: ['shop.example.com'], manifest: { connectors: { keyed: { host: 'api.example.com', paths: ['/v1/x'], methods: ['GET'], secret: { name: 'API_KEY', in: 'query', field: 'key' } } } } },
    off: { enabled: false, manifest: { connectors: {} } },
};

async function boot(o = {}) {
    let t = Date.UTC(2026, 9, 5, 12, 0, 10);
    const now = () => t;
    const mk = (cfg) => createLimiter({ store: memoryStore({ now }), now, ...cfg });
    const limiter = mk({ perIpPerMin: o.perIp ?? 3, perAppPerMin: 100, dailyCalls: 1000, dailySpendMicros: 50_000 });
    const globalAi = mk({ perIpPerMin: 100000, perAppPerMin: 100000, dailyCalls: 100000, dailySpendMicros: o.globalCap ?? 2_000_000 });
    const events = []; const logs = []; const upstream = []; const secretReads = [];
    const meter = createMeter({ sink: async (e) => { events.push(e); }, now });
    const fetchImpl = async (url, init) => {
        upstream.push({ url: String(url), init });
        if (String(url).includes('openrouter.ai')) return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: o.aiCost ?? 0.002 } }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response('{"v":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const handler = createHandler({
        appStore: { get: async (id) => APPS[id] || null },
        secretStore: { get: async (appId, name) => { secretReads.push([appId, name]); return name === 'API_KEY' ? SECRET : undefined; } },
        limiter, globalAiLimiter: globalAi, meter, fetchImpl, resolve: async () => ['93.184.216.34'],
        openRouterKey: OR_KEY, log: (l) => logs.push(l), baseDomain: 'vibebuild.cc',
    });
    const server = http.createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const call = (path, { method = 'POST', body, headers = {} } = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', 'fly-client-ip': '7.7.7.7', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { call, events, logs, upstream, secretReads, close: () => server.close() };
}
const kcall = { connector: 'keyed', method: 'GET', path: '/v1/x', query: { city: 'PrivateTown' } };

test('GET /health is 200 and reveals nothing', async () => {
    const s = await boot(); const r = await s.call('/health', { method: 'GET' });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true }); s.close();
});

test('POST /:app/api runs the connector with the vault secret and returns the upstream body', async () => {
    const s = await boot(); const r = await s.call('/app1/api', { body: kcall });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { v: 1 });
    assert.equal(new URL(s.upstream[0].url).searchParams.get('key'), SECRET);
    s.close();
});

test('only the secret the connector declares is read from the vault', async () => {
    const s = await boot(); await s.call('/app1/api', { body: kcall });
    assert.deepEqual(s.secretReads, [['app1', 'API_KEY']]); s.close();
});

test('built-in connectors work for an app that declares none', async () => {
    const s = await boot(); const r = await s.call('/app1/api', { body: { connector: 'nws', method: 'GET', path: '/points/1,1' } });
    assert.equal(r.status, 200); assert.match(s.upstream[0].url, /^https:\/\/api\.weather\.gov\/points/); s.close();
});

test('unknown app is 404 and a disabled app is 403, with no upstream call', async () => {
    const s = await boot();
    assert.equal((await s.call('/nope/api', { body: kcall })).status, 404);
    assert.equal((await s.call('/off/api', { body: { connector: 'nws', method: 'GET', path: '/points/1,1' } })).status, 403);
    assert.equal(s.upstream.length, 0); s.close();
});

test('invalid JSON is 400, an oversized body is 413, other methods 405, other paths 404', async () => {
    const s = await boot();
    assert.equal((await s.call('/app1/api', { body: '{not json' })).status, 400);
    assert.equal((await s.call('/app1/api', { body: JSON.stringify({ connector: 'nws', method: 'GET', path: '/points/1,1' }) + ' '.repeat(300_000) })).status, 413);
    assert.equal((await s.call('/app1/api', { method: 'GET' })).status, 405);
    assert.equal((await s.call('/app1/other', { body: {} })).status, 404);
    s.close();
});

test('rate limits use fly-client-ip and ignore a spoofed x-forwarded-for', async () => {
    const s = await boot();
    const b = { connector: 'nws', method: 'GET', path: '/points/1,1' };
    for (let i = 0; i < 3; i++) assert.equal((await s.call('/app1/api', { body: b, headers: { 'x-forwarded-for': `9.9.9.${i}` } })).status, 200);
    const r = await s.call('/app1/api', { body: b, headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.equal(r.status, 429); assert.ok(r.headers.get('retry-after')); s.close();
});

test('CORS: preflight and responses allow the app origin and its registered custom domain only', async () => {
    const s = await boot();
    for (const origin of ['https://app1.vibebuild.cc', 'https://shop.example.com']) {
        const p = await s.call('/app1/api', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
        assert.equal(p.status, 204); assert.equal(p.headers.get('access-control-allow-origin'), origin);
    }
    const bad = await s.call('/app1/api', { method: 'OPTIONS', headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    const post = await s.call('/app1/api', { body: { connector: 'nws', method: 'GET', path: '/points/1,1' }, headers: { origin: 'https://evil.example.com' } });
    assert.equal(post.status, 403); assert.equal(s.upstream.length, 0);
    const plain = await s.call('/app1/api', { body: { connector: 'nws', method: 'GET', path: '/points/1,1' }, headers: { origin: 'http://app1.vibebuild.cc' } });
    assert.equal(plain.status, 403);
    const other = await s.call('/app1/api', { body: { connector: 'nws', method: 'GET', path: '/points/1,1' }, headers: { origin: 'https://app2.vibebuild.cc' } });
    assert.equal(other.status, 403); s.close();
});

test('responses are not cacheable and not sniffable', async () => {
    const s = await boot(); const r = await s.call('/app1/api', { body: { connector: 'nws', method: 'GET', path: '/points/1,1' } });
    assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); s.close();
});

test('POST /:app/ai calls OpenRouter with the platform key and returns text', async () => {
    const s = await boot(); const r = await s.call('/app1/ai', { body: { messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(r.status, 200); assert.equal((await r.json()).text, 'hi');
    assert.equal(new Headers(s.upstream[0].init.headers).get('authorization'), 'Bearer ' + OR_KEY); s.close();
});

test('a platform-wide AI daily cap stops every app and makes no provider call', async () => {
    const s = await boot({ globalCap: 3000, aiCost: 0.002, perIp: 100 });
    const q = { messages: [{ role: 'user', content: 'hi' }] };
    await s.call('/app1/ai', { body: q }); await s.call('/app1/ai', { body: q });
    const before = s.upstream.length;
    const r = await s.call('/app1/ai', { body: q });
    assert.equal(r.status, 429); assert.equal((await r.json()).error, 'platform_ai_cap');
    assert.equal(s.upstream.length, before); s.close();
});

test('logs and usage events never contain secrets, the platform key, query values or prompts', async () => {
    const s = await boot();
    await s.call('/app1/api', { body: kcall });
    await s.call('/app1/ai', { body: { messages: [{ role: 'user', content: 'private question' }] } });
    const text = JSON.stringify([s.logs, s.events]);
    for (const bad of [SECRET, OR_KEY, 'PrivateTown', 'private question']) assert.equal(text.includes(bad), false, bad);
    assert.ok(s.logs.length >= 2); s.close();
});
