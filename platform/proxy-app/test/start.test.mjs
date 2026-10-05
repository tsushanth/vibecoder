import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../start.js';
import { createPgStores } from '../../store/pg.js';
import { loadConfig } from '../config.js';

let db, skip, MK;
before(async () => { db = await scratchDb(); if (db.unavailable) skip = db.unavailable; MK = masterKey(); });
after(async () => { if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const cfg = (extra = {}) => loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: MK, OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PORT: '8080', ...extra });
const fakeFetch = (log) => async (url, init) => { log.push(String(url)); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.002 } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
const boot = (extra, deps = {}) => startServer(cfg(extra), { pool: db.pool, listenPort: 0, resolve: async () => ['93.184.216.34'], ...deps });
const url = (s, p) => `http://127.0.0.1:${s.port}${p}`;
const post = (s, p, body, ip = '9.9.9.9') => fetch(url(s, p), { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': ip }, body: JSON.stringify(body) });
const ask = { messages: [{ role: 'user', content: 'hi' }] };

t('boots against a migrated database and answers /health', async () => {
    const s = await boot(); const r = await fetch(url(s, '/health'));
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true }); await s.close();
});

t('refuses to start when the platform schema is missing and says to run the migration', async () => {
    const empty = new pg.Pool({ host: 'localhost', user: process.env.USER, database: 'postgres', max: 1 });
    try {
        await assert.rejects(() => startServer(cfg(), { pool: empty, listenPort: 0 }), /migrat/i);
    } finally { await empty.end(); }
});

t('refuses to start when the database cannot be reached, without printing the connection string', async () => {
    const dead = new pg.Pool({ connectionString: 'postgres://nobody:SuperSecretPw@127.0.0.1:1/none', max: 1, connectionTimeoutMillis: 500 });
    try { await assert.rejects(() => startServer(cfg(), { pool: dead, listenPort: 0 }), (e) => !e.message.includes('SuperSecretPw')); } finally { await dead.end().catch(() => {}); }
});

t('unknown apps are 404 and disabled apps 403 over the real wiring', async () => {
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    await stores.upsertApp({ appId: 'offapp', enabled: false });
    const s = await boot();
    assert.equal((await post(s, '/nobody/api', { connector: 'nws', method: 'GET', path: '/points/1,1' })).status, 404);
    assert.equal((await post(s, '/offapp/api', { connector: 'nws', method: 'GET', path: '/points/1,1' })).status, 403);
    await s.close();
});

t('the per-app AI daily cap comes from APP_AI_DAILY_MICROS', async () => {
    const stores = createPgStores({ pool: db.pool, masterKey: MK }); await stores.upsertApp({ appId: 'capapp', enabled: true });
    const log = []; const s = await boot({ APP_AI_DAILY_MICROS: '3000' }, { fetchImpl: fakeFetch(log) });
    assert.equal((await post(s, '/capapp/ai', ask)).status, 200);   // 2000
    assert.equal((await post(s, '/capapp/ai', ask)).status, 200);   // 4000, now over the cap
    const r = await post(s, '/capapp/ai', ask);
    assert.equal(r.status, 429); assert.equal((await r.json()).error, 'spend_cap'); assert.equal(log.length, 2); await s.close();
});

t('the platform-wide AI cap comes from PLATFORM_AI_DAILY_MICROS and stops every app', async () => {
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    await stores.upsertApp({ appId: 'plat1', enabled: true }); await stores.upsertApp({ appId: 'plat2', enabled: true });
    await db.pool.query("delete from platform.limiter_counters where key like 'spend:__platform_ai__%'"); // earlier tests spent against the shared platform counter
    const log = []; const s = await boot({ PLATFORM_AI_DAILY_MICROS: '3000' }, { fetchImpl: fakeFetch(log) });
    await post(s, '/plat1/ai', ask); await post(s, '/plat2/ai', ask);
    const r = await post(s, '/plat1/ai', ask, '8.8.8.8');
    assert.equal(r.status, 429); assert.equal((await r.json()).error, 'platform_ai_cap'); assert.equal(log.length, 2); await s.close();
});

t('the per-IP rate limit comes from PER_IP_PER_MIN', async () => {
    const stores = createPgStores({ pool: db.pool, masterKey: MK }); await stores.upsertApp({ appId: 'rateapp', enabled: true });
    const s = await boot({ PER_IP_PER_MIN: '2' });
    const codes = []; for (let i = 0; i < 3; i++) codes.push((await post(s, '/rateapp/api', { connector: 'nws', method: 'GET', path: '/points/1,1' }, '4.4.4.4')).status);
    assert.equal(codes[2], 429); await s.close();
});

t('close stops listening so the port refuses new connections', async () => {
    const s = await boot(); await s.close();
    await assert.rejects(() => fetch(url(s, '/health')));
});

t('startServer does not log secrets while booting', async () => {
    const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
    try { const s = await boot(); await post(s, '/nobody/api', {}); await s.close(); } finally { console.log = orig; }
    const out = lines.join('\n'); for (const bad of [MK, 'sk-or-v1-FAKE']) assert.equal(out.includes(bad), false);
});

t('a database error that contains a password is never surfaced in the startup error', async () => {
    const leaky = { query: async () => { throw new Error('password authentication failed for user "x" password=SuperSecretPw'); }, end: async () => {} };
    await assert.rejects(() => startServer(cfg(), { pool: leaky, listenPort: 0 }), (e) => !e.message.includes('SuperSecretPw') && /database/i.test(e.message));
});

t('without a listenPort override the server binds the configured PORT', async () => {
    const port = 41000 + Math.floor(Math.random() * 2000);
    const s = await startServer(cfg({ PORT: String(port) }), { pool: db.pool, resolve: async () => ['93.184.216.34'] });
    assert.equal(s.port, port);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    await s.close();
});

t('an explicit listenPort of 0 picks a free port, not the configured one', async () => {
    const s = await boot(); assert.notEqual(s.port, 8080); await s.close();
});
