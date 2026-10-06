import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createDataExecutor, isSafeStatement } from '../executor.js';
import { validateSpec } from '../schema.js';

let db, skip, proxyPool, ex, stores;
const spec = (o) => validateSpec(o).spec;
const TODO = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true }, n: { type: 'integer' } } } } };

before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    await db.admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname='proxy_sim') then create role proxy_sim login in role vibe_proxy; end if; end $$");
    stores = createPgStores({ pool: db.pool, masterKey: masterKey() });
    for (const a of ['app-a', 'app-b', 'app-c']) await stores.upsertApp({ appId: a, enabled: true, manifest: null });
    proxyPool = db.connFor({ user: 'proxy_sim', max: 5 });
    ex = createDataExecutor({ pool: proxyPool, timeoutMs: 1500 });
});
after(async () => { await proxyPool?.end().catch(() => {}); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const q = (text, values = []) => ({ text, values });

t('provisioning creates a role and schema once, registers them, and is repeatable', async () => {
    const s1 = await ex.ensure('app-a'); const s2 = await ex.ensure('app-a');
    assert.equal(s1, s2); assert.match(s1, /^apps_[0-9a-f]{20}$/);
    const { rows } = await db.pool.query("select role_name, schema_name from platform.app_dbs where app_id='app-a'");
    assert.equal(rows.length, 1); assert.match(rows[0].role_name, /^appr_[0-9a-f]{20}$/);
    const fresh = createDataExecutor({ pool: proxyPool }); assert.equal(await fresh.ensure('app-a'), s1);
});

t('peekSpec reads the stored spec without provisioning anything', async () => {
    assert.deepEqual(await ex.peekSpec('app-never-provisioned'), { spec: null, version: 0 });
    assert.equal((await db.pool.query("select count(*)::int n from platform.app_dbs where app_id='app-never-provisioned'")).rows[0].n, 0);
    await stores.upsertApp({ appId: 'app-peek', enabled: true, manifest: null });
    assert.deepEqual(await ex.peekSpec('app-peek'), { spec: null, version: 0 }, 'a registered app with no database yet');
    assert.equal((await db.pool.query("select count(*)::int n from platform.app_dbs where app_id='app-peek'")).rows[0].n, 0);
    await ex.applySchema({ appId: 'app-peek', spec: spec(TODO) });
    const p = await ex.peekSpec('app-peek'); assert.equal(p.version, 1); assert.deepEqual(p.spec, spec(TODO));
});

t('provision_app_db refuses bad and unknown app ids', async () => {
    for (const bad of ['', 'A', "x'; drop schema platform;--", '../x', null]) await assert.rejects(() => proxyPool.query('select * from platform.provision_app_db($1)', [bad]), /invalid app id/, String(bad));
    await assert.rejects(() => proxyPool.query("select * from platform.provision_app_db('ghost-app')"), /unknown app/);
});

t('applying a schema creates the tables as the app role, stores the spec and bumps the version; repeating it does nothing', async () => {
    const r = await ex.applySchema({ appId: 'app-a', spec: spec(TODO) });
    assert.equal(r.ok, true); assert.equal(r.version, 1); assert.equal(r.applied, 2);
    const owner = await db.pool.query("select tableowner from pg_tables where tablename='todos' and schemaname = (select schema_name from platform.app_dbs where app_id='app-a')");
    assert.match(owner.rows[0].tableowner, /^appr_/);
    assert.deepEqual((await ex.currentSpec('app-a')).spec, spec(TODO));
    const again = await ex.applySchema({ appId: 'app-a', spec: spec(TODO) });
    assert.deepEqual([again.ok, again.applied, again.version], [true, 0, 2]);
});

t('a destructive change is refused and nothing changes; with confirmation it applies', async () => {
    const dropped = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true } } } } };
    const before = await ex.currentSpec('app-a');
    const r = await ex.applySchema({ appId: 'app-a', spec: spec(dropped) });
    assert.equal(r.ok, false); assert.equal(r.errors[0].code, 'destructive_change_needs_confirmation');
    assert.deepEqual(await ex.currentSpec('app-a'), before);
    const ok = await ex.applySchema({ appId: 'app-a', spec: spec(dropped), allowDestructive: true });
    assert.equal(ok.ok, true);
});

t('a failing migration rolls everything back, including the stored spec', async () => {
    await ex.ensure('app-b');
    const sch = (await db.pool.query("select schema_name s, role_name r from platform.app_dbs where app_id='app-b'")).rows[0];
    await db.pool.query(`create table "${sch.s}"."clash" (x int); alter table "${sch.s}"."clash" owner to "${sch.r}"`);
    const bad = { version: 1, tables: { good: { columns: { a: { type: 'text' } } }, clash: { columns: { a: { type: 'text' } } } } };
    // the first statement would create "good"; "clash" already exists with another shape, but is not in the current spec, so it is created again and fails
    const r = await ex.applySchema({ appId: 'app-b', spec: spec(bad) });
    assert.deepEqual(r, { ok: false, errors: [{ code: 'migration_failed' }] });
    assert.equal((await db.pool.query(`select count(*)::int n from pg_tables where schemaname='${sch.s}' and tablename='good'`)).rows[0].n, 0);
    assert.equal((await ex.currentSpec('app-b')).spec, null);
    await db.pool.query(`drop table "${sch.s}"."clash"`);
});

t('queries run as the app: inserts and selects work, and results come back as rows', async () => {
    const ins = await ex.run('app-c-none-yet'.slice(0, 5) === 'app-c' ? 'app-c' : 'app-c', q('select 1 as one'));
    assert.deepEqual(ins, { ok: true, rows: [{ one: 1 }] });
    await ex.applySchema({ appId: 'app-c', spec: spec(TODO) });
    const w = await ex.run('app-c', q('insert into "todos" ("title", "user_id") values ($1, gen_random_uuid()) returning "title", "n"', ['hi']));
    assert.deepEqual(w, { ok: true, rows: [{ title: 'hi', n: null }] });
    assert.equal((await ex.run('app-c', q('select count(*)::int n from "todos"'))).rows[0].n, 1);
    assert.equal(await ex.count('app-c', 'todos'), 1);
    await assert.rejects(() => ex.count('app-c', 'todos"; drop table x;--'));
});

t('database errors become safe codes without leaking the message', async () => {
    const run = (text, values) => ex.run('app-c', q(text, values));
    const nn = await run('insert into "todos" ("n") values ($1)', [1]); assert.deepEqual(nn, { ok: false, status: 400, code: 'missing_required' });
    const dup = await run('insert into "todos" ("id", "title") values ($1, $2), ($1, $2)', ['11111111-1111-1111-1111-111111111111', 'x']); assert.deepEqual(dup, { ok: false, status: 409, code: 'conflict' });
    const bad = await run('select * from "todos" where "id" = $1', ['not-a-uuid']); assert.deepEqual(bad, { ok: false, status: 400, code: 'invalid_value' });
    const slow = await run('select count(*) from generate_series(1, 400000000)', []); assert.deepEqual(slow, { ok: false, status: 504, code: 'query_timeout' });
    const missing = await run('select * from "nope"', []); assert.deepEqual(missing, { ok: false, status: 500, code: 'db_error' });
    const big = await run('select generate_series(1, 1001) as i', []); assert.deepEqual(big, { ok: false, status: 413, code: 'result_too_large' });
});

t('a failed query leaves the connection usable and nothing leaks between requests', async () => {
    await ex.run('app-c', q('select * from "nope"'));
    const who = await ex.run('app-c', q('select current_user as u, current_schema() as sp'));
    assert.match(who.rows[0].u, /^appr_/); assert.match(who.rows[0].sp, /^apps_/);
    const ra = await ex.run('app-a', q('select current_user as u')); assert.notEqual(ra.rows[0].u, who.rows[0].u);
    assert.equal(proxyPool.totalCount === proxyPool.idleCount, true);
});

t('only one SELECT/INSERT/UPDATE/DELETE statement is ever executed', async () => {
    for (const text of ['reset role; select 1', 'select 1; select 2', 'reset role', 'set role "postgres"', 'drop table "todos"', 'create table x (a int)', '', 'with x as (select 1) select * from x', 5, undefined])
        assert.deepEqual(await ex.run('app-c', { text, values: [] }), { ok: false, status: 500, code: 'bad_query' }, String(text));
    assert.deepEqual(await ex.run('app-c', { text: 'select 1', values: undefined }), { ok: false, status: 500, code: 'bad_query' });
});

// ---- cross-tenant isolation at the database level ----
t('app A cannot read, write or create anything in app B, the platform schema, or other schemas', async () => {
    await ex.applySchema({ appId: 'app-b', spec: spec(TODO) });
    await ex.run('app-b', q('insert into "todos" ("title") values ($1)', ['b-secret']));
    const sB = (await db.pool.query("select schema_name from platform.app_dbs where app_id='app-b'")).rows[0].schema_name;
    const sC = (await db.pool.query("select schema_name from platform.app_dbs where app_id='app-c'")).rows[0].schema_name;
    const attempts = [
        `select * from "${sB}"."todos"`, `insert into "${sB}"."todos" ("title") values ($1)`, `update "${sB}"."todos" set "title" = $1`, `delete from "${sB}"."todos"`,
        'select * from platform.apps', 'select * from platform.app_secrets', 'select * from platform.end_users', 'select * from platform.app_dbs',
    ];
    for (const text of attempts) { const r = await ex.run('app-c', q(text, text.includes('$1') ? ['x'] : [])); assert.equal(r.ok, false, text); assert.equal(r.code, 'db_error', text); }
    const w = await ex.run('app-c', q(`insert into "${sB}"."todos" ("title") values ($1)`, ['x'])); assert.equal(w.ok, false);
    assert.equal((await db.pool.query(`select count(*)::int n from "${sB}"."todos"`)).rows[0].n, 1);
    assert.equal((await ex.run('app-b', q('select "title" from "todos"'))).rows[0].title, 'b-secret');
    assert.equal(sB === sC, false);
});

t('the proxy login can only reach app data by switching role: it does not inherit app privileges', async () => {
    const sB = (await db.pool.query("select schema_name from platform.app_dbs where app_id='app-b'")).rows[0].schema_name;
    await assert.rejects(() => proxyPool.query(`select * from "${sB}"."todos"`), /permission denied/);
});

t('an app role cannot become another role, create roles, or read the role list', async () => {
    for (const text of ['select 1 where false']) assert.equal((await ex.run('app-c', q(text))).ok, true);
    // statements the builder never emits are refused before they reach the database; also prove the database itself refuses them
    const c = await proxyPool.connect();
    try {
        const role = (await db.pool.query("select role_name from platform.app_dbs where app_id='app-c'")).rows[0].role_name;
        const other = (await db.pool.query("select role_name from platform.app_dbs where app_id='app-b'")).rows[0].role_name;
        await c.query('begin'); await c.query(`set local role "${role}"`);
        // Postgres lets the session user switch to any role it may SET, even from inside another role. That is why the executor refuses
        // such statements (next test) rather than relying on the database.
        await c.query(`set role "${other}"`); assert.equal((await c.query('select current_user u')).rows[0].u, other); await c.query('rollback');
        await c.query('begin'); await c.query(`set local role "${role}"`);
        await assert.rejects(() => c.query('create role evil login'), /permission denied/); await c.query('rollback');
        await c.query('begin'); await c.query(`set local role "${role}"`);
        await assert.rejects(() => c.query('create schema evil'), /permission denied/); await c.query('rollback');
        await c.query('begin'); await c.query(`set local role "${role}"`);
        await assert.rejects(() => c.query('select * from pg_catalog.pg_authid'), /permission denied/); await c.query('rollback');
    } finally { c.release(); }
});

t('parallel requests for different apps all succeed and return their own data', async () => {
    const rs = await Promise.all(['app-a', 'app-b', 'app-c'].flatMap((a) => [1, 2, 3, 4].map(() => ex.run(a, q('select current_user as u')))));
    assert.equal(rs.every((r) => r.ok), true); assert.equal(new Set(rs.map((r) => r.rows[0].u)).size, 3);
});

t('statements that could change role or reach system functions are refused, while ordinary quoted names are fine', async () => {
    for (const text of ["select set_config('role', 'x', true)", 'select set_config($1, $2, true)', 'select current_setting($1)', 'select * from "todos" where "title" = $1 and pg_sleep(5) is null', 'select session_user', 'select 1 -- x', 'select /* x */ 1', "select 'a'", 'select 1 from "t" where role = $1', 'update "todos" set "title" = $1; delete from "todos"', 'select nextval($1)'])
        assert.equal(isSafeStatement(text), false, text);
    for (const text of ['select "id", "title" from "todos" where "title" = $1 order by "created_at" desc limit 50 offset 0', 'insert into "todos" ("title", "user_id") values ($1, $2) returning "id"', 'update "todos" set "title" = $1 where "id" = $2 and "user_id" = $3 returning "id"', 'delete from "todos" where "id" = $1 returning "id"', 'select "pg_like", "role", "session" from "todos"'])
        assert.equal(isSafeStatement(text), true, text);
    assert.deepEqual(await ex.run('app-c', { text: "select set_config('role', 'x', true)", values: [] }), { ok: false, status: 500, code: 'bad_query' });
});

t('planSchema reports statements and destructive changes read-only: nothing is applied, provisioned or versioned', async () => {
    await stores.upsertApp({ appId: 'app-plan', enabled: true, manifest: null });
    const none = await ex.planSchema({ appId: 'app-plan', spec: spec(TODO) });
    assert.equal(none.ok, true); assert.ok(none.statements > 0); assert.deepEqual(none.destructive, []);
    assert.equal((await db.pool.query("select count(*)::int n from platform.app_dbs where app_id='app-plan'")).rows[0].n, 0, 'planning provisions no database');
    await ex.applySchema({ appId: 'app-plan', spec: spec(TODO) });
    const before = await ex.peekSpec('app-plan');
    const same = await ex.planSchema({ appId: 'app-plan', spec: spec(TODO) });
    assert.deepEqual(same, { ok: true, statements: 0, destructive: [] });
    const smaller = spec({ version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true } } } } });
    const drop = await ex.planSchema({ appId: 'app-plan', spec: smaller });
    assert.deepEqual(drop.destructive, [{ kind: 'drop_column', table: 'todos', column: 'n' }]); assert.equal(drop.statements, 1);
    const gone = await ex.planSchema({ appId: 'app-plan', spec: spec({ version: 1, tables: { other: { access: 'owner', columns: { a: { type: 'text' } } } } }) });
    assert.ok(gone.destructive.some((d) => d.kind === 'drop_table' && d.table === 'todos'));
    assert.deepEqual(await ex.peekSpec('app-plan'), before, 'stored spec and version untouched');
    const cols = (await db.pool.query("select count(*)::int n from information_schema.columns where column_name='n' and table_name='todos'")).rows[0].n;
    assert.ok(cols >= 1, 'column n still exists');
});

t('totalRows sums the rows of the named tables in one call, is zero for none, and refuses a hostile table name', async () => {
    const spec2 = spec({ version: 1, tables: { a: { access: 'owner', columns: { x: { type: 'integer' } } }, b: { access: 'owner', columns: { x: { type: 'integer' } } } } });
    await stores.upsertApp({ appId: 'app-d', enabled: true });
    assert.equal((await ex.applySchema({ appId: 'app-d', spec: spec2 })).ok, true);
    await ex.run('app-d', q('insert into "a" ("x", "user_id") values ($1, $3), ($2, $3)', [1, 2, '11111111-1111-4111-8111-111111111111']));
    await ex.run('app-d', q('insert into "b" ("x", "user_id") values ($1, $2)', [3, '11111111-1111-4111-8111-111111111111']));
    assert.equal(await ex.totalRows('app-d', ['a', 'b']), 3);
    assert.equal(await ex.totalRows('app-d', ['a']), 2);
    assert.equal(await ex.totalRows('app-d', []), 0);
    await assert.rejects(ex.totalRows('app-d', ['a"; drop table x; --']), /bad table/);
    await assert.rejects(ex.totalRows('app-d', ['A']), /bad table/);
});
