// End to end over the real wiring (start.js): HTTP admin route -> validateSpec -> executor -> per-app Postgres role and schema.
// The pool is a login that is only a member of vibe_proxy (does not inherit app privileges), as in production.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { startServer } from '../start.js';
import { loadConfig } from '../config.js';
import { createDataExecutor } from '../../data/executor.js';

const ADMIN_T = 'admin-' + 'q'.repeat(40);
const TODO = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true }, n: { type: 'integer' } } } } };
const TODO_DROP_N = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true } } } } };
let db, skip, proxyPool, s;

before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    await db.admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname='proxy_sim') then create role proxy_sim login in role vibe_proxy; end if; end $$");
    proxyPool = db.connFor({ user: 'proxy_sim', max: 5 });
    const config = loadConfig({ DATABASE_URL: 'postgres://unused/x', VIBE_MASTER_KEY: masterKey(), OPENROUTER_API_KEY: 'sk-or-v1-FAKE', BASE_DOMAIN: 'vibebuild.cc', PORT: '8080', PROXY_ADMIN_TOKEN: ADMIN_T });
    s = await startServer(config, { pool: proxyPool, listenPort: 0, resolve: async () => ['93.184.216.34'] });
});
after(async () => { await s?.close().catch(() => {}); await proxyPool?.end().catch(() => {}); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const call = (method, path, body, token = ADMIN_T) => fetch(`http://127.0.0.1:${s.port}${path}`, {
    method, headers: { 'content-type': 'application/json', 'fly-client-ip': '5.5.5.5', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
});
const rows = async (appId, sql, values = []) => createDataExecutor({ pool: proxyPool }).run(appId, { text: sql, values });

t('registering an app then pushing a schema creates real tables in that app only, and GET shows the spec', async () => {
    assert.equal((await call('POST', '/admin/apps/shop-a/ensure')).status, 204);
    assert.equal((await call('POST', '/admin/apps/shop-b/ensure')).status, 204);
    const r = await call('POST', '/admin/apps/shop-a/schema', { spec: TODO });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { version: 1, applied: 2 });
    assert.deepEqual((await rows('shop-a', 'select count(*)::int n from "todos"')).rows, [{ n: 0 }]);
    assert.equal((await rows('shop-b', 'select count(*)::int n from "todos"')).ok, false, 'the other app has no such table');
    const g = await call('GET', '/admin/apps/shop-a/schema');
    assert.equal(g.status, 200); const gj = await g.json();
    assert.equal(gj.version, 1); assert.equal(gj.spec.tables.todos.columns.n.type, 'integer');
    assert.equal(JSON.stringify(gj).includes('appr_'), false); assert.equal(JSON.stringify(gj).includes('apps_'), false);
});

t('pushing the same schema again is a no-op over HTTP', async () => {
    const r = await call('POST', '/admin/apps/shop-a/schema', { spec: TODO });
    assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.applied, 0);
});

t('a destructive change is 409 with data intact; with allowDestructive it applies', async () => {
    assert.equal((await rows('shop-a', 'insert into "todos" ("title", "n") values ($1, $2) returning "n"', ['keep', 7])).ok, true);
    const r = await call('POST', '/admin/apps/shop-a/schema', { spec: TODO_DROP_N });
    assert.equal(r.status, 409); const j = await r.json();
    assert.equal(j.error, 'destructive_change_needs_confirmation'); assert.deepEqual(j.destructive, [{ kind: 'drop_column', table: 'todos', column: 'n' }]);
    assert.deepEqual((await rows('shop-a', 'select "n" from "todos"')).rows, [{ n: '7' }]);
    const ok = await call('POST', '/admin/apps/shop-a/schema', { spec: TODO_DROP_N, allowDestructive: true });
    assert.equal(ok.status, 200);
    assert.equal((await rows('shop-a', 'select "n" from "todos"')).ok, false);
});

t('an invalid spec is 400 invalid_schema and changes nothing', async () => {
    const before = await (await call('GET', '/admin/apps/shop-a/schema')).json();
    const r = await call('POST', '/admin/apps/shop-a/schema', { spec: { version: 1, tables: { 'x; drop schema platform': { columns: {} } } } });
    assert.equal(r.status, 400); assert.equal((await r.json()).error, 'invalid_schema');
    assert.deepEqual(await (await call('GET', '/admin/apps/shop-a/schema')).json(), before);
});

t('a migration that fails in the database is 422 migration_failed and the stored spec is untouched', async () => {
    await call('POST', '/admin/apps/shop-b/schema', { spec: { version: 1, tables: { good: { columns: { a: { type: 'text' } } } } } });
    const sch = (await db.pool.query("select schema_name s, role_name r from platform.app_dbs where app_id='shop-b'")).rows[0];
    await db.pool.query(`create table "${sch.s}"."clash" (x int); alter table "${sch.s}"."clash" owner to "${sch.r}"`);
    const r = await call('POST', '/admin/apps/shop-b/schema', { spec: { version: 1, tables: { good: { columns: { a: { type: 'text' } } }, clash: { columns: { a: { type: 'text' } } } } } });
    assert.equal(r.status, 422); const txt = await r.text();
    assert.deepEqual(JSON.parse(txt), { error: 'migration_failed' });
    assert.deepEqual(Object.keys((await (await call('GET', '/admin/apps/shop-b/schema')).json()).spec.tables), ['good']);
});

t('an unknown app is 404 and no database is provisioned for it, on POST or GET', async () => {
    assert.equal((await call('POST', '/admin/apps/ghost-app/schema', { spec: TODO })).status, 404);
    assert.equal((await call('GET', '/admin/apps/ghost-app/schema')).status, 404);
    assert.equal((await db.pool.query("select count(*)::int n from platform.app_dbs where app_id='ghost-app'")).rows[0].n, 0);
});

t('GET on a registered app that has no database yet answers version 0 and does not provision one', async () => {
    await call('POST', '/admin/apps/fresh-app/ensure');
    const g = await call('GET', '/admin/apps/fresh-app/schema');
    assert.deepEqual(await g.json(), { version: 0, spec: null });
    assert.equal((await db.pool.query("select count(*)::int n from platform.app_dbs where app_id='fresh-app'")).rows[0].n, 0);
});

t('without the admin token the schema route is 401 and nothing is created', async () => {
    assert.equal((await call('POST', '/admin/apps/shop-a/schema', { spec: TODO }, null)).status, 401);
    assert.equal((await call('GET', '/admin/apps/shop-a/schema', undefined, 'nope')).status, 401);
});

t('a schema of realistic maximum size fits the route body limit', async () => {
    const columns = {}; for (let i = 0; i < 30; i++) columns[`column_number_${String(i).padStart(2, '0')}_name`] = { type: 'text', default: 'x'.repeat(100) };
    const tables = {}; for (let i = 0; i < 20; i++) tables[`table_number_${String(i).padStart(2, '0')}`] = { access: 'owner', columns };
    const body = { spec: { version: 1, tables } };
    assert.ok(JSON.stringify(body).length > 8192, 'bigger than the default admin limit');
    assert.ok(JSON.stringify(body).length < 131072);
    await call('POST', '/admin/apps/big-app/ensure');
    const r = await call('POST', '/admin/apps/big-app/schema', body);
    assert.equal(r.status, 200, await r.clone().text());
});
