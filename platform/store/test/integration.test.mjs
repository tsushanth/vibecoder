import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { scratchDb, masterKey } from './helpers.mjs';
import { createPgStores } from '../pg.js';
import { createHandler } from '../../proxy-app/server.js';
import { createLimiter } from '../../vibe-proxy/limits.js';
import { createMeter } from '../../vibe-proxy/meter.js';

const SECRET = 'LiveSecretValue987654321';
let db, skip, server, port, stores, upstream = [];

before(async () => {
    db = await scratchDb();
    if (db.unavailable) { skip = db.unavailable; return; }
    stores = createPgStores({ pool: db.pool, masterKey: masterKey() });
    await stores.upsertApp({ appId: 'demo', domains: [], enabled: true, manifest: { connectors: { keyed: { host: 'api.example.com', paths: ['/v1/x'], methods: ['GET'], secret: { name: 'API_KEY', in: 'query', field: 'key' } } } } });
    await stores.secretStore.set('demo', 'API_KEY', SECRET);
    const fetchImpl = async (url, init) => { upstream.push(String(url)); return new Response('{"from":"upstream"}', { status: 200, headers: { 'content-type': 'application/json' } }); };
    const limiter = createLimiter({ store: stores.limiterStore, perIpPerMin: 5 });
    const globalAiLimiter = createLimiter({ store: stores.limiterStore, perIpPerMin: 1e6, perAppPerMin: 1e6, dailyCalls: 1e6 });
    const handler = createHandler({ appStore: stores.appStore, secretStore: stores.secretStore, limiter, globalAiLimiter, meter: createMeter({ sink: stores.usageSink }), fetchImpl, resolve: async () => ['93.184.216.34'], openRouterKey: 'sk-or-v1-FAKE0123456789', baseDomain: 'vibebuild.cc' });
    server = http.createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
});
after(async () => { server?.close(); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const call = (path, body, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': '8.8.4.4', ...headers }, body: JSON.stringify(body) });

t('end to end: HTTP request -> Postgres app and decrypted secret -> upstream with the key -> usage row', async () => {
    const r = await call('/demo/api', { connector: 'keyed', method: 'GET', path: '/v1/x', query: { q: 'hello' } });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { from: 'upstream' });
    assert.equal(new URL(upstream[0]).searchParams.get('key'), SECRET);
    const day = new Date().toISOString().slice(0, 10);
    assert.deepEqual(await stores.usageSummary('demo', day), { keyed: { calls: 1, errors: 0, responseBytes: 19 } });
});

t('end to end: the rate limit is enforced through Postgres counters', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await call('/demo/api', { connector: 'keyed', method: 'GET', path: '/v1/x' }, { 'fly-client-ip': '5.5.5.5' })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
});

t('end to end: a disabled app and an unknown app are refused, and the secret never appears in any stored row', async () => {
    await stores.upsertApp({ appId: 'dead', enabled: false, manifest: null });
    assert.equal((await call('/dead/api', { connector: 'nws', method: 'GET', path: '/points/1,1' })).status, 403);
    assert.equal((await call('/ghost/api', { connector: 'nws', method: 'GET', path: '/points/1,1' })).status, 404);
    const dump = await db.pool.query("select (select coalesce(string_agg(row_to_json(u)::text, ' '), '') from platform.usage_events u) || (select coalesce(string_agg(row_to_json(c)::text, ' '), '') from platform.limiter_counters c) || (select coalesce(string_agg(row_to_json(a)::text, ' '), '') from platform.apps a) as d");
    assert.equal(dump.rows[0].d.includes(SECRET), false);
});
