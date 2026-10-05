import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../start.js';
import { loadConfig } from '../config.js';
import { moveSecretsToVault } from '../../vibe-proxy/vault-capture.js';

const j = (...p) => p.join('');
const KEY = j('AIza', 'SyA1234567890abcdefghijklmnopqrstuv');
const ADMIN = 'admin-' + 'e'.repeat(40);
let db, skip, srv, upstream = [], logs = [];

before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    const config = loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: masterKey(), OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PORT: '8080', PROXY_ADMIN_TOKEN: ADMIN });
    srv = await startServer(config, { pool: db.pool, listenPort: 0, resolve: async () => ['93.184.216.34'], log: (l) => logs.push(l), fetchImpl: async (url) => { upstream.push(String(url)); return new Response('{"maps":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } }); } });
});
after(async () => { await srv?.close(); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const base = () => `http://127.0.0.1:${srv.port}`;
const admin = (method, path, body) => fetch(base() + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}`, 'fly-client-ip': '5.5.5.5' }, body: body === undefined ? undefined : JSON.stringify(body) });

t('a key pasted into chat ends up encrypted in the vault, is used by a connector call, and appears nowhere else', async () => {
    const manifest = { connectors: { maps: { host: 'maps.example.com', paths: ['/api/*'], methods: ['GET'], secret: { name: 'GOOGLE_API_KEY', in: 'query', field: 'key' } } } };
    assert.equal((await admin('PUT', '/admin/apps/e2eapp', { manifest })).status, 204);

    const r = await moveSecretsToVault({
        text: `Make a map app. My Google key is ${KEY}, use it.`, appId: 'e2eapp',
        listNames: async (id) => (await (await admin('GET', `/admin/apps/${id}/secrets`)).json()).secrets.map((s) => s.name),
        setSecret: async (id, name, value) => { const res = await admin('PUT', `/admin/apps/${id}/secrets/${name}`, { value }); if (res.status !== 204) throw new Error('vault ' + res.status); },
    });
    assert.deepEqual(r.stored, ['GOOGLE_API_KEY']); assert.deepEqual(r.failed, []);
    assert.equal(r.text, 'Make a map app. My Google key is [SECRET:GOOGLE_API_KEY], use it.');

    // the vault holds it encrypted, and the list shows the name only
    const listed = await (await admin('GET', '/admin/apps/e2eapp/secrets')).text();
    assert.match(listed, /GOOGLE_API_KEY/); assert.equal(listed.includes(KEY), false);
    const rows = await db.pool.query('select ciphertext from platform.app_secrets');
    for (const row of rows.rows) assert.equal(Buffer.from(row.ciphertext).includes(Buffer.from(KEY)), false);

    // the connector call uses it
    const call = await fetch(base() + '/e2eapp/api', { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': '4.4.4.4' }, body: JSON.stringify({ connector: 'maps', method: 'GET', path: '/api/geocode', query: { q: 'x' } }) });
    assert.equal(call.status, 200);
    assert.equal(new URL(upstream.at(-1)).searchParams.get('key'), KEY);
    assert.equal((await call.text()).includes(KEY), false);

    // logs and usage rows never carry the key
    const usage = await db.pool.query("select row_to_json(u)::text as j from platform.usage_events u");
    for (const text of [logs.join('\n'), usage.rows.map((x) => x.j).join('\n')]) assert.equal(text.includes(KEY), false);
});
