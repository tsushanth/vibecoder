import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scratchDb } from './helpers.mjs';
import { applyMigrations } from '../migrate.js';

let db, skip;
before(async () => { db = await scratchDb({ migrate: false }); if (db.unavailable) skip = db.unavailable; });
after(async () => { if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const tables = async () => (await db.pool.query("select table_name from information_schema.tables where table_schema='platform' order by 1")).rows.map((r) => r.table_name);

t('applies the real migrations to an empty database', async () => {
    assert.deepEqual(await tables(), []);
    const r = await applyMigrations(db.pool);
    assert.deepEqual(r.applied, ['001_platform.sql', '002_end_user_auth.sql', '003_app_databases.sql', '004_storage.sql', '005_orders.sql', '006_notify.sql']);
    assert.deepEqual(await tables(), ['app_dbs', 'app_secrets', 'apps', 'end_users', 'files', 'limiter_counters', 'login_links', 'notify_optouts', 'orders', 'schema_migrations', 'sessions', 'usage_events']);
});

t('running it again applies nothing and changes nothing', async () => {
    const r = await applyMigrations(db.pool);
    assert.deepEqual(r.applied, []); assert.deepEqual(r.skipped, ['001_platform.sql', '002_end_user_auth.sql', '003_app_databases.sql', '004_storage.sql', '005_orders.sql', '006_notify.sql']);
});

t('migrations run in filename order, each in a transaction, and a failure stops the run and records nothing for it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '002_ok.sql'), 'create table platform.m_ok (id int);');
    fs.writeFileSync(path.join(dir, '003_bad.sql'), 'create table platform.m_half (id int); select 1/0;');
    fs.writeFileSync(path.join(dir, '004_never.sql'), 'create table platform.m_never (id int);');
    await assert.rejects(() => applyMigrations(db.pool, { dir }), /003_bad\.sql/);
    const names = await tables();
    assert.ok(names.includes('m_ok')); assert.equal(names.includes('m_half'), false); assert.equal(names.includes('m_never'), false);
    const done = (await db.pool.query('select name from platform.schema_migrations order by name')).rows.map((r) => r.name);
    assert.ok(done.includes('002_ok.sql')); assert.equal(done.includes('003_bad.sql'), false); assert.equal(done.includes('004_never.sql'), false);
    fs.rmSync(dir, { recursive: true, force: true });
});

t('a migration whose contents changed after it was applied is refused', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '010_x.sql'), 'create table platform.m_x (id int);');
    await applyMigrations(db.pool, { dir });
    fs.writeFileSync(path.join(dir, '010_x.sql'), 'create table platform.m_x (id int, extra int);');
    await assert.rejects(() => applyMigrations(db.pool, { dir }), /changed/i);
    fs.rmSync(dir, { recursive: true, force: true });
});

t('concurrent runs do not apply a migration twice', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '020_c.sql'), 'select pg_sleep(0.4); create table platform.m_c (id int);');
    const results = await Promise.allSettled([applyMigrations(db.pool, { dir }), applyMigrations(db.pool, { dir }), applyMigrations(db.pool, { dir })]);
    assert.equal(results.filter((r) => r.status === 'fulfilled' && r.value.applied.includes('020_c.sql')).length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

t('after a failed migration the connection is usable again (rolled back, lock released) even with a pool of one', async () => {
    const one = db.connFor({ max: 1 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '030_bad.sql'), 'select 1/0;');
    await assert.rejects(() => applyMigrations(one, { dir }), /030_bad/);
    fs.writeFileSync(path.join(dir, '030_bad.sql'), 'create table platform.m_after (id int);');
    const r = await applyMigrations(one, { dir });
    assert.deepEqual(r.applied, ['030_bad.sql']);
    await one.end(); fs.rmSync(dir, { recursive: true, force: true });
});

t('the migrations table itself has row level security on', async () => {
    const { rows } = await db.pool.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='platform' and relname='schema_migrations'");
    assert.equal(rows[0].relrowsecurity, true);
});
