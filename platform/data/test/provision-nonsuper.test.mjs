import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createDataExecutor } from '../executor.js';
import { validateSpec } from '../schema.js';

// Supabase's postgres role is not a superuser. Reproduce that: the function owner is a CREATEROLE role with ordinary rights.
let db, skip, pool;
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    await db.admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname='prov_sim') then create role prov_sim createrole bypassrls; end if; alter role prov_sim createrole bypassrls nosuperuser; if not exists (select 1 from pg_roles where rolname='proxy_sim') then create role proxy_sim login in role vibe_proxy; end if; end $$");
    await db.pool.query(`grant create on database ${db.name} to prov_sim; grant usage on schema platform to prov_sim; grant select, insert, update on platform.app_dbs to prov_sim; grant select on platform.apps to prov_sim; alter function platform.provision_app_db(text) owner to prov_sim`);
    await createPgStores({ pool: db.pool, masterKey: masterKey() }).upsertApp({ appId: 'ns-app', enabled: true });
    pool = db.connFor({ user: 'proxy_sim', max: 3 });
});
after(async () => { await pool?.end().catch(() => {}); if (db && !db.unavailable) { await db.admin.query('drop owned by prov_sim').catch(() => {}); await db.cleanup(); await db.admin.query('drop role if exists prov_sim').catch(() => {}); } });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });

t('the owner really is not a superuser', async () => {
    const r = await db.pool.query("select rolsuper, rolcreaterole from pg_roles where rolname='prov_sim'"); assert.deepEqual(r.rows[0], { rolsuper: false, rolcreaterole: true });
});

t('provisioning, schema apply and queries work when the function owner is a CREATEROLE non-superuser', async () => {
    const ex = createDataExecutor({ pool });
    const schema = await ex.ensure('ns-app'); assert.match(schema, /^apps_/);
    const spec = validateSpec({ version: 1, tables: { notes: { access: 'public_read', columns: { body: { type: 'text' } } } } }).spec;
    assert.equal((await ex.applySchema({ appId: 'ns-app', spec })).ok, true);
    assert.deepEqual(await ex.run('ns-app', { text: `select count(*)::int n from "notes"`, values: [] }), { ok: true, rows: [{ n: 0 }] });
    assert.equal((await ex.run('ns-app', { text: 'select * from platform.apps', values: [] })).ok, false);
});
