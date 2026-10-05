import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createHandler } from '../server.js';
import { createLimiter } from '../../vibe-proxy/limits.js';
import { createMeter } from '../../vibe-proxy/meter.js';

const TOKEN = 'admin-token-' + 'x'.repeat(40);
const SECRET = 'AdminSetSecretValue0987654321';
let db, skip, stores, server, port, logs = [];

before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    stores = createPgStores({ pool: db.pool, masterKey: masterKey() });
    await stores.upsertApp({ appId: 'myapp', enabled: true });
    const limiter = createLimiter({ store: stores.limiterStore }); const globalAiLimiter = createLimiter({ store: stores.limiterStore, dailySpendMicros: 1e9 });
    const handler = createHandler({
        appStore: stores.appStore, secretStore: stores.secretStore, limiter, globalAiLimiter, meter: createMeter({ sink: stores.usageSink }),
        fetchImpl: async () => new Response('{}'), resolve: async () => ['93.184.216.34'], openRouterKey: 'sk-or-v1-FAKE', baseDomain: 'vibebuild.cc',
        log: (l) => logs.push(l), adminToken: TOKEN, upsertApp: stores.upsertApp, ensureApp: stores.ensureApp, setEnabled: stores.setEnabled, limiterStore: stores.limiterStore,
    });
    server = http.createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port;
});
after(async () => { server?.close(); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });

const call = (method, path, { body, token = TOKEN, headers = {}, ip = '6.6.6.6' } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'content-type': 'application/json', 'fly-client-ip': ip, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});

t('no token, a wrong token and a wrong scheme are all 401 with the same body', async () => {
    const bodies = [];
    for (const h of [{ token: null }, { token: 'wrong-token' }, { token: null, headers: { authorization: `Basic ${TOKEN}` } }, { token: TOKEN.slice(0, -1) }]) {
        const r = await call('PUT', '/admin/apps/myapp/secrets/API_KEY', { body: { value: SECRET }, ip: '1.2.3.4', ...h });
        assert.equal(r.status, 401); bodies.push(await r.text());
    }
    assert.equal(new Set(bodies).size, 1);
    assert.equal(await stores.secretStore.has('myapp', 'API_KEY'), false);
});

t('PUT a secret stores it encrypted, answers 204 with no body, and never echoes the value', async () => {
    const r = await call('PUT', '/admin/apps/myapp/secrets/API_KEY', { body: { value: SECRET } });
    assert.equal(r.status, 204); assert.equal(await r.text(), '');
    assert.equal(await stores.secretStore.get('myapp', 'API_KEY'), SECRET);
});

t('PUT overwrites an existing secret', async () => {
    await call('PUT', '/admin/apps/myapp/secrets/API_KEY', { body: { value: SECRET + 'NEW' } });
    assert.equal(await stores.secretStore.get('myapp', 'API_KEY'), SECRET + 'NEW');
});

t('PUT validates the secret name, the value and the app', async () => {
    assert.equal((await call('PUT', '/admin/apps/myapp/secrets/lower_case', { body: { value: SECRET } })).status, 400);
    assert.equal((await call('PUT', '/admin/apps/myapp/secrets/GOOD_NAME', { body: { value: '' } })).status, 400);
    assert.equal((await call('PUT', '/admin/apps/myapp/secrets/GOOD_NAME', { body: { value: 'x'.repeat(5000) } })).status, 400);
    assert.equal((await call('PUT', '/admin/apps/myapp/secrets/GOOD_NAME', { body: { value: 12345 } })).status, 400);
    assert.equal((await call('PUT', '/admin/apps/myapp/secrets/GOOD_NAME', { body: '{not json' })).status, 400);
    assert.equal((await call('PUT', '/admin/apps/ghostapp/secrets/GOOD_NAME', { body: { value: SECRET } })).status, 404);
    assert.equal(await stores.secretStore.has('myapp', 'GOOD_NAME'), false);
});

t('an oversized admin body is 413', async () => {
    assert.equal((await call('PUT', '/admin/apps/myapp/secrets/BIG_ONE', { body: JSON.stringify({ value: 'a'.repeat(20000) }) })).status, 413);
});

t('GET lists names and update times only, never values', async () => {
    await call('PUT', '/admin/apps/myapp/secrets/ZZ_KEY', { body: { value: 'ListedSecretValue111' } });
    const r = await call('GET', '/admin/apps/myapp/secrets'); const text = await r.text();
    assert.equal(r.status, 200);
    const j = JSON.parse(text);
    assert.ok(j.secrets.some((s) => s.name === 'API_KEY') && j.secrets.some((s) => s.name === 'ZZ_KEY'));
    for (const s of j.secrets) assert.deepEqual(Object.keys(s).sort(), ['name', 'updatedAt']);
    for (const bad of [SECRET, 'ListedSecretValue111']) assert.equal(text.includes(bad), false);
});

t('there is no way to read a secret value back', async () => {
    for (const [m, p] of [['GET', '/admin/apps/myapp/secrets/API_KEY'], ['POST', '/admin/apps/myapp/secrets/API_KEY'], ['PATCH', '/admin/apps/myapp/secrets/API_KEY']]) {
        const r = await call(m, p, { body: m === 'GET' ? undefined : {} }); const text = await r.text();
        assert.ok([404, 405].includes(r.status), `${m} ${r.status}`); assert.equal(text.includes(SECRET), false);
    }
});

t('DELETE removes a secret and is idempotent', async () => {
    assert.equal((await call('DELETE', '/admin/apps/myapp/secrets/ZZ_KEY')).status, 204);
    assert.equal(await stores.secretStore.has('myapp', 'ZZ_KEY'), false);
    assert.equal((await call('DELETE', '/admin/apps/myapp/secrets/ZZ_KEY')).status, 204);
    assert.equal((await call('DELETE', '/admin/apps/myapp/secrets/bad name')).status, 400);
});

t('PUT /admin/apps/:app registers an app with a valid manifest and domains', async () => {
    const m = { connectors: { keyed: { host: 'api.example.com', paths: ['/v1/x'], methods: ['GET'], secret: { name: 'API_KEY', in: 'query', field: 'key' } } } };
    const r = await call('PUT', '/admin/apps/newapp', { body: { manifest: m, domains: ['shop.example.com'], enabled: true } });
    assert.equal(r.status, 204);
    assert.deepEqual(await stores.appStore.get('newapp'), { enabled: true, domains: ['shop.example.com'], manifest: m });
});

t('PUT /admin/apps/:app rejects bad manifests, reserved names, bad domains and bad app ids', async () => {
    const badM = { connectors: { x: { host: '8.8.8.8', paths: ['/'], methods: ['GET'] } } };
    const r1 = await call('PUT', '/admin/apps/badapp1', { body: { manifest: badM } }); assert.equal(r1.status, 400); assert.ok((await r1.json()).problems.length >= 1);
    assert.equal((await call('PUT', '/admin/apps/badapp2', { body: { manifest: { connectors: { nws: { host: 'evil.example.com', paths: ['/x'], methods: ['GET'] } } } } })).status, 400);
    assert.equal((await call('PUT', '/admin/apps/badapp3', { body: { domains: ['https://not-a-host/'] } })).status, 400);
    assert.equal((await call('PUT', '/admin/apps/badapp4', { body: { domains: ['a.vibebuild.cc'] } })).status, 400);
    assert.equal((await call('PUT', '/admin/apps/Bad_App', { body: {} })).status, 404);
    for (const id of ['badapp1', 'badapp2', 'badapp3', 'badapp4']) assert.equal(await stores.appStore.get(id), null);
});

t('admin responses never carry CORS headers and a browser preflight is refused', async () => {
    const r = await call('PUT', '/admin/apps/myapp/secrets/CORS_KEY', { body: { value: SECRET }, headers: { origin: 'https://myapp.vibebuild.cc' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    const p = await call('OPTIONS', '/admin/apps/myapp/secrets/CORS_KEY', { token: null, headers: { origin: 'https://myapp.vibebuild.cc', 'access-control-request-method': 'PUT' } });
    assert.ok([401, 403, 404, 405].includes(p.status)); assert.equal(p.headers.get('access-control-allow-origin'), null);
});

t('admin responses are not cacheable', async () => {
    const r = await call('GET', '/admin/apps/myapp/secrets'); assert.equal(r.headers.get('cache-control'), 'no-store');
});

t('repeated bad tokens from one address are rate limited, even for the right token afterwards', async () => {
    const ip = '7.7.7.7'; const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await call('GET', '/admin/apps/myapp/secrets', { token: 'nope', ip })).status);
    assert.equal(codes.slice(0, 10).every((c) => c === 401), true); assert.equal(codes[11], 429);
    assert.equal((await call('GET', '/admin/apps/myapp/secrets', { ip })).status, 429);
    assert.equal((await call('GET', '/admin/apps/myapp/secrets', { ip: '8.8.8.8' })).status, 200);
});

t('logs never contain the admin token or any secret value', async () => {
    await call('PUT', '/admin/apps/myapp/secrets/LOG_KEY', { body: { value: 'LoggedSecretValue777' } });
    await call('GET', '/admin/apps/myapp/secrets', { token: 'wrong-token-attempt', ip: '9.9.9.1' });
    const text = logs.join('\n');
    for (const bad of [TOKEN, 'wrong-token-attempt', 'LoggedSecretValue777', SECRET]) assert.equal(text.includes(bad), false, bad);
    assert.ok(logs.some((l) => /"route":"admin"/.test(l)));
});

t('the data routes are unaffected by the admin routes', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`); assert.equal(r.status, 200);
    const nf = await fetch(`http://127.0.0.1:${port}/admin`, { headers: { authorization: `Bearer ${TOKEN}` } }); assert.ok([404, 405].includes(nf.status));
});

t('without an admin token configured every /admin path is a plain 404, never a crash', async () => {
    const noAdmin = http.createServer(createHandler({ appStore: stores.appStore, secretStore: stores.secretStore, limiter: createLimiter({ store: stores.limiterStore }), globalAiLimiter: createLimiter({ store: stores.limiterStore }), meter: createMeter({ sink: async () => {} }), fetchImpl: async () => new Response('{}'), resolve: async () => ['93.184.216.34'], openRouterKey: 'x', baseDomain: 'vibebuild.cc' }));
    await new Promise((r) => noAdmin.listen(0, '127.0.0.1', r));
    try {
        for (const [m, p] of [['GET', '/admin/apps/myapp/secrets'], ['PUT', '/admin/apps/myapp/secrets/API_KEY'], ['GET', '/admin']]) {
            const r = await fetch(`http://127.0.0.1:${noAdmin.address().port}${p}`, { method: m, headers: { authorization: `Bearer ${TOKEN}` }, body: m === 'PUT' ? JSON.stringify({ value: 'x'.repeat(10) }) : undefined });
            assert.equal(r.status, 404, `${m} ${p}`);
        }
    } finally { noAdmin.close(); }
});

t('POST /admin/apps/:app/ensure creates a missing app and leaves an existing one untouched', async () => {
    assert.equal(await stores.appStore.get('ensureme'), null);
    assert.equal((await call('POST', '/admin/apps/ensureme/ensure')).status, 204);
    assert.deepEqual(await stores.appStore.get('ensureme'), { enabled: true, domains: [], manifest: null });
    const m = { connectors: { keyed: { host: 'api.example.com', paths: ['/v1/x'], methods: ['GET'] } } };
    await stores.upsertApp({ appId: 'ensure-keep', manifest: m, domains: ['k.example.com'], enabled: false });
    assert.equal((await call('POST', '/admin/apps/ensure-keep/ensure', { body: { manifest: null, enabled: true, domains: [] } })).status, 204);
    assert.deepEqual(await stores.appStore.get('ensure-keep'), { enabled: false, domains: ['k.example.com'], manifest: m }, 'a body must not change an existing app');
});

t('ensure needs the admin token, a valid app id and POST', async () => {
    assert.equal((await call('POST', '/admin/apps/ensure-x/ensure', { token: null })).status, 401);
    assert.equal((await call('POST', '/admin/apps/Bad_App/ensure')).status, 404);
    assert.equal((await call('PUT', '/admin/apps/ensure-y/ensure')).status, 405);
    assert.equal(await stores.appStore.get('ensure-x'), null);
});

t('POST /admin/apps/:app/enabled flips the flag and keeps the manifest, 404 for an unknown app, 400 for a bad body', async () => {
    const m = { connectors: { keyed: { host: 'api.example.com', paths: ['/v1/x'], methods: ['GET'] } } };
    await stores.upsertApp({ appId: 'toggle-app', manifest: m, domains: [], enabled: true });
    assert.equal((await call('POST', '/admin/apps/toggle-app/enabled', { body: { enabled: false } })).status, 204);
    assert.deepEqual(await stores.appStore.get('toggle-app'), { enabled: false, domains: [], manifest: m });
    assert.equal((await call('POST', '/admin/apps/toggle-app/enabled', { body: { enabled: true } })).status, 204);
    assert.equal((await stores.appStore.get('toggle-app')).enabled, true);
    assert.equal((await call('POST', '/admin/apps/no-such-app/enabled', { body: { enabled: false } })).status, 404);
    for (const body of [{}, { enabled: 'yes' }, { enabled: 1 }, '{nope']) assert.equal((await call('POST', '/admin/apps/toggle-app/enabled', { body })).status, 400, JSON.stringify(body));
    assert.equal((await call('POST', '/admin/apps/toggle-app/enabled', { token: null, body: { enabled: false } })).status, 401);
});

t('ensure and enabled reject extra path segments', async () => {
    assert.equal((await call('POST', '/admin/apps/ensure-z/ensure/extra')).status, 404);
    assert.equal((await call('POST', '/admin/apps/toggle-app/enabled/extra', { body: { enabled: false } })).status, 404);
    assert.equal(await stores.appStore.get('ensure-z'), null);
});
