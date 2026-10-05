import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createHandler } from '../server.js';
import { createLimiter } from '../../vibe-proxy/limits.js';
import { createMeter } from '../../vibe-proxy/meter.js';

const TOKEN = 'admin-token-' + 'x'.repeat(40);
// built from fragments so no scanner mistakes a fixture for a credential
const VALUE = ['Fixture', 'Value', '0123456789'].join('-');
const M = { connectors: { weather: { host: 'api.example.com', paths: ['/v1/*'], methods: ['GET'], secret: { name: 'WEATHER_KEY', in: 'query', field: 'appid' } } } };
let db, skip, stores, server, port;

before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    stores = createPgStores({ pool: db.pool, masterKey: masterKey() });
    const limiter = createLimiter({ store: stores.limiterStore }); const globalAiLimiter = createLimiter({ store: stores.limiterStore, dailySpendMicros: 1e9 });
    server = http.createServer(createHandler({
        appStore: stores.appStore, secretStore: stores.secretStore, limiter, globalAiLimiter, meter: createMeter({ sink: stores.usageSink }),
        fetchImpl: async () => new Response('{}'), resolve: async () => ['93.184.216.34'], openRouterKey: 'x', baseDomain: 'vibebuild.cc',
        adminToken: TOKEN, upsertApp: stores.upsertApp, ensureApp: stores.ensureApp, setEnabled: stores.setEnabled, setDomains: stores.setDomains,
        setManifest: stores.setManifest, copySecrets: stores.copySecrets, limiterStore: stores.limiterStore,
    }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
});
after(async () => { server?.close(); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const call = (method, path, body, token = TOKEN) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'content-type': 'application/json', 'fly-client-ip': '7.7.7.7', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
});

t('POST manifest sets only the manifest: enabled, domains and secrets are untouched', async () => {
    await stores.upsertApp({ appId: 'keep1', manifest: null, domains: ['shop.example.org'], enabled: false });
    await stores.secretStore.set('keep1', 'WEATHER_KEY', VALUE);
    const r = await call('POST', '/admin/apps/keep1/manifest', { manifest: M });
    assert.equal(r.status, 204);
    assert.deepEqual(await stores.appStore.get('keep1'), { enabled: false, domains: ['shop.example.org'], manifest: M });
    assert.equal(await stores.secretStore.get('keep1', 'WEATHER_KEY'), VALUE);
});

t('POST manifest null clears the manifest', async () => {
    assert.equal((await call('POST', '/admin/apps/keep1/manifest', { manifest: null })).status, 204);
    assert.equal((await stores.appStore.get('keep1')).manifest, null);
});

t('POST manifest rejects invalid manifests (private host, header injection, reserved name) and leaves the old one', async () => {
    await call('POST', '/admin/apps/keep1/manifest', { manifest: M });
    const bad = [
        { connectors: { x: { host: '10.0.0.1', paths: ['/'], methods: ['GET'] } } },
        { connectors: { x: { host: 'internal.corp', paths: ['/'], methods: ['GET'] } } },
        { connectors: { x: { host: 'api.example.com', paths: ['/'], methods: ['GET'], headers: { a: 'b' } } } },
        { connectors: { nws: { host: 'api.example.com', paths: ['/'], methods: ['GET'] } } },
        { connectors: {} },
    ];
    for (const manifest of bad) assert.equal((await call('POST', '/admin/apps/keep1/manifest', { manifest })).status, 400, JSON.stringify(manifest));
    assert.equal((await call('POST', '/admin/apps/keep1/manifest', { manifest: 'nope' })).status, 400);
    assert.equal((await call('POST', '/admin/apps/keep1/manifest', {})).status, 400);
    assert.deepEqual((await stores.appStore.get('keep1')).manifest, M);
});

t('POST manifest on an unknown app is 404 and creates nothing', async () => {
    assert.equal((await call('POST', '/admin/apps/ghost1/manifest', { manifest: M })).status, 404);
    assert.equal(await stores.appStore.get('ghost1'), null);
});

t('POST manifest requires the admin token', async () => {
    assert.equal((await call('POST', '/admin/apps/keep1/manifest', { manifest: null }, 'wrong')).status, 401);
    assert.deepEqual((await stores.appStore.get('keep1')).manifest, M);
});

t('GET app returns enabled and the declared secrets per connector, no values', async () => {
    await stores.secretStore.set('keep1', 'WEATHER_KEY', VALUE);
    const r = await call('GET', '/admin/apps/keep1'); const text = await r.text();
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(text), { enabled: false, connectors: [{ name: 'weather', host: 'api.example.com', secret: { name: 'WEATHER_KEY', in: 'query' } }] });
    assert.equal(text.includes(VALUE), false);
});

t('GET app for an app without a manifest has an empty connector list; unknown app is 404', async () => {
    await stores.upsertApp({ appId: 'plain1' });
    assert.deepEqual(await (await call('GET', '/admin/apps/plain1')).json(), { enabled: true, connectors: [] });
    assert.equal((await call('GET', '/admin/apps/ghost1')).status, 404);
});

t('copy-secrets copies every secret from one app to another, re-encrypted, and overwrites same names', async () => {
    await stores.upsertApp({ appId: 'src1' }); await stores.upsertApp({ appId: 'dst1' });
    await stores.secretStore.set('src1', 'A_KEY', VALUE + 'A'); await stores.secretStore.set('src1', 'B_KEY', VALUE + 'B');
    await stores.secretStore.set('dst1', 'A_KEY', 'old-value-1234'); await stores.secretStore.set('dst1', 'C_KEY', VALUE + 'C');
    const r = await call('POST', '/admin/apps/dst1/copy-secrets', { from: 'src1' });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { copied: 2 });
    assert.equal(await stores.secretStore.get('dst1', 'A_KEY'), VALUE + 'A');
    assert.equal(await stores.secretStore.get('dst1', 'B_KEY'), VALUE + 'B');
    assert.equal(await stores.secretStore.get('dst1', 'C_KEY'), VALUE + 'C');
    assert.equal(await stores.secretStore.get('src1', 'A_KEY'), VALUE + 'A');
});

t('copy-secrets validates ids, requires both apps and refuses copying onto itself', async () => {
    assert.equal((await call('POST', '/admin/apps/dst1/copy-secrets', { from: 'ghost1' })).status, 404);
    assert.equal((await call('POST', '/admin/apps/ghost1/copy-secrets', { from: 'src1' })).status, 404);
    assert.equal((await call('POST', '/admin/apps/dst1/copy-secrets', { from: 'Bad_Id' })).status, 400);
    assert.equal((await call('POST', '/admin/apps/dst1/copy-secrets', {})).status, 400);
    assert.equal((await call('POST', '/admin/apps/dst1/copy-secrets', { from: 'dst1' })).status, 400);
    assert.equal((await call('POST', '/admin/apps/dst1/copy-secrets', { from: 'src1' }, 'wrong')).status, 401);
});

t('copy-secrets with nothing to copy is a harmless zero', async () => {
    await stores.upsertApp({ appId: 'empty1' });
    const r = await call('POST', '/admin/apps/dst1/copy-secrets', { from: 'empty1' });
    assert.deepEqual(await r.json(), { copied: 0 });
});
