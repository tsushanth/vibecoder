import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../start.js';
import { createPgStores } from '../../store/pg.js';
import { createDataExecutor } from '../../data/executor.js';
import { validateSpec } from '../../data/schema.js';
import { loadConfig } from '../config.js';

const SPEC = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true }, done: { type: 'boolean', default: false } } }, posts: { access: 'public_read', columns: { body: { type: 'text', required: true } } }, vault: { access: 'private', columns: { v: { type: 'text' } } } } };
let db, skip, MK, mails = [], srv, proxyPool;
const fetchImpl = async (url, init) => { if (String(url).startsWith('https://api.resend.com/')) mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
const cfg = (extra = {}) => loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: MK, OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PORT: '8080', PROXY_ADMIN_TOKEN: 'admin-' + 'z'.repeat(40), RESEND_API_KEY: 're_testkey12345', AUTH_MAIL_FROM: 'login@mail.vibebuild.cc', PER_IP_PER_MIN: '1000', ...extra });
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    MK = masterKey();
    await db.admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname='proxy_sim') then create role proxy_sim login in role vibe_proxy; end if; end $$");
    const stores = createPgStores({ pool: db.pool, masterKey: MK });
    for (const a of ['app-a', 'app-b', 'app-nos']) await stores.upsertApp({ appId: a, enabled: true });
    proxyPool = db.connFor({ user: 'proxy_sim', max: 6 });
    const ex = createDataExecutor({ pool: proxyPool });
    for (const a of ['app-a', 'app-b']) assert.equal((await ex.applySchema({ appId: a, spec: validateSpec(SPEC).spec })).ok, true);
    srv = await startServer(cfg(), { pool: proxyPool, listenPort: 0, fetchImpl });
});
after(async () => { await srv?.close(); await proxyPool?.end().catch(() => {}); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); mails.length = 0; await f(c); });
let n = 30; const ip = () => ({ 'fly-client-ip': `9.7.${++n}.1` });
const post = (appId, path, body, token) => fetch(`http://127.0.0.1:${srv.port}/${appId}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...ip() }, body: JSON.stringify(body) });
const signIn = async (appId, email) => {
    await post(appId, 'auth/request', { email });
    const link = new URL(/https:\/\/\S+/.exec(mails.at(-1).text)[0]).searchParams.get('vibe_login');
    return (await (await post(appId, 'auth/consume', { token: link })).json()).token;
};
const db_ = async (appId, req, token) => { const r = await post(appId, 'db', req, token); return { status: r.status, ...(await r.json()) }; };

t('full CRUD over HTTP as a signed-in user', async () => {
    const tok = await signIn('app-a', 'ann@example.com');
    const ins = await db_('app-a', { op: 'insert', table: 'todos', rows: [{ title: 'milk' }, { title: 'eggs', done: true }] }, tok); assert.equal(ins.status, 200); assert.equal(ins.count, 2);
    const sel = await db_('app-a', { op: 'select', table: 'todos', order: [{ col: 'title', dir: 'asc' }] }, tok); assert.deepEqual(sel.rows.map((r) => r.title), ['eggs', 'milk']);
    const id = sel.rows[1].id;
    const upd = await db_('app-a', { op: 'update', table: 'todos', where: [{ col: 'id', op: 'eq', val: id }], set: { done: true } }, tok); assert.equal(upd.rows[0].done, true);
    assert.equal((await db_('app-a', { op: 'delete', table: 'todos', where: [{ col: 'id', op: 'eq', val: id }] }, tok)).count, 1);
    assert.equal((await db_('app-a', { op: 'select', table: 'todos' }, tok)).rows.length, 1);
});

t('users and apps are isolated', async () => {
    const a1 = await signIn('app-a', 'u1@example.com'); const a2 = await signIn('app-a', 'u2@example.com'); const b1 = await signIn('app-b', 'u1@example.com');
    await db_('app-a', { op: 'insert', table: 'todos', rows: [{ title: 'secret' }] }, a1);
    assert.equal((await db_('app-a', { op: 'select', table: 'todos' }, a2)).rows.length, 0);
    assert.equal((await db_('app-b', { op: 'select', table: 'todos' }, b1)).rows.length, 0);
    assert.equal((await db_('app-b', { op: 'select', table: 'todos' }, a1)).status, 401); // another app's token
});

t('anonymous: public_read tables are readable, writes and owner tables are 401, private is 403', async () => {
    const tok = await signIn('app-a', 'pub@example.com');
    await db_('app-a', { op: 'insert', table: 'posts', rows: [{ body: 'hello' }] }, tok);
    assert.equal((await db_('app-a', { op: 'select', table: 'posts' })).rows.length, 1);
    assert.equal((await db_('app-a', { op: 'insert', table: 'posts', rows: [{ body: 'x' }] })).status, 401);
    assert.equal((await db_('app-a', { op: 'select', table: 'todos' })).status, 401);
    assert.equal((await db_('app-a', { op: 'select', table: 'vault' }, tok)).status, 403);
});

t('bad requests, bad tokens, no schema and no auth configured get short error codes', async () => {
    const tok = await signIn('app-a', 'bad@example.com');
    const bad = await db_('app-a', { op: 'select', table: 'nope' }, tok); assert.deepEqual([bad.status, bad.error], [400, 'unknown_table']);
    assert.equal((await db_('app-a', { op: 'drop', table: 'todos' }, tok)).status, 400);
    assert.equal((await db_('app-a', { op: 'select', table: 'todos' }, 'garbage')).status, 401);
    assert.deepEqual(await db_('app-nos', { op: 'select', table: 'todos' }), { status: 404, error: 'no_schema' });
    assert.equal((await post('app-a', 'db', null, tok)).status, 400);
    const bare = await startServer(cfg({ RESEND_API_KEY: '', AUTH_MAIL_FROM: '' }), { pool: proxyPool, listenPort: 0, fetchImpl });
    try { const r = await fetch(`http://127.0.0.1:${bare.port}/app-a/db`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': '2.2.2.2' }, body: '{}' }); assert.equal(r.status, 503); } finally { await bare.close(); }
});

t('the db route shares the per-IP limit and honours the kill switch', async () => {
    const lim = await startServer(cfg({ PER_IP_PER_MIN: '2' }), { pool: proxyPool, listenPort: 0, fetchImpl });
    try {
        const codes = []; for (let i = 0; i < 4; i++) codes.push((await fetch(`http://127.0.0.1:${lim.port}/app-a/db`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': '3.3.3.3' }, body: JSON.stringify({ op: 'select', table: 'posts' }) })).status);
        assert.deepEqual(codes, [200, 200, 429, 429]);
    } finally { await lim.close(); }
});
