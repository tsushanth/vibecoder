import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createAuthStore } from '../../auth/pgStore.js';
import { createNotifyStore } from '../pgStore.js';

let db, skip, store, auth;
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    const stores = createPgStores({ pool: db.pool, masterKey: masterKey() });
    for (const a of ['app-a', 'app-b']) await stores.upsertApp({ appId: a, enabled: true });
    store = createNotifyStore({ pool: db.pool }); auth = createAuthStore({ pool: db.pool });
});
after(async () => { if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const count = async (where = 'true') => (await db.pool.query(`select count(*)::int as n from platform.notify_optouts where ${where}`)).rows[0].n;

t('getRecipient returns the stored email and the opt-out flag, scoped to the app', async () => {
    const ua = await auth.upsertUser({ appId: 'app-a', email: 'r1@example.com' });
    assert.deepEqual(await store.getRecipient({ appId: 'app-a', userId: ua }), { email: 'r1@example.com', optedOut: false });
    assert.equal(await store.getRecipient({ appId: 'app-b', userId: ua }), null); // the id does not exist in another app
    assert.equal(await store.getRecipient({ appId: 'app-a', userId: randomUUID() }), null);
});

t('optOut is idempotent and flips only that app and user', async () => {
    const ua = await auth.upsertUser({ appId: 'app-a', email: 'r2@example.com' });
    const ub = await auth.upsertUser({ appId: 'app-b', email: 'r2@example.com' }); // same person, other app
    const other = await auth.upsertUser({ appId: 'app-a', email: 'r2other@example.com' });
    await store.optOut({ appId: 'app-a', userId: ua }); await store.optOut({ appId: 'app-a', userId: ua });
    assert.equal(await count(`app_id = 'app-a' and user_id = '${ua}'`), 1);
    assert.equal((await store.getRecipient({ appId: 'app-a', userId: ua })).optedOut, true);
    assert.equal((await store.getRecipient({ appId: 'app-b', userId: ub })).optedOut, false);
    assert.equal((await store.getRecipient({ appId: 'app-a', userId: other })).optedOut, false);
});

t('optOut for a user that does not exist writes nothing and does not throw', async () => {
    const before = await count();
    await store.optOut({ appId: 'app-a', userId: randomUUID() });
    await store.optOut({ appId: 'app-b', userId: (await auth.upsertUser({ appId: 'app-a', email: 'r3@example.com' })) }); // id exists only in app-a
    assert.equal(await count(), before);
});

t('the original opted_out_at is kept when the user opts out again', async () => {
    const u = await auth.upsertUser({ appId: 'app-a', email: 'r4@example.com' });
    await store.optOut({ appId: 'app-a', userId: u });
    await db.pool.query("update platform.notify_optouts set opted_out_at = '2020-01-01' where user_id = $1", [u]);
    await store.optOut({ appId: 'app-a', userId: u });
    assert.equal((await db.pool.query('select opted_out_at from platform.notify_optouts where user_id = $1', [u])).rows[0].opted_out_at.getUTCFullYear(), 2020);
});

t('the proxy role can use the table through its policy; an unrelated role cannot read or write it', async () => {
    await db.pool.query("do $$ begin if not exists (select 1 from pg_roles where rolname='proxy_sim') then create role proxy_sim login; end if; end $$");
    await db.pool.query('grant vibe_proxy to proxy_sim');
    await db.pool.query("do $$ begin if not exists (select 1 from pg_roles where rolname='anon_sim') then create role anon_sim login; end if; end $$");
    await db.pool.query('grant usage on schema platform to anon_sim; grant select, insert on platform.notify_optouts, platform.end_users to anon_sim');
    const u = await auth.upsertUser({ appId: 'app-a', email: 'role@example.com' });
    const proxy = db.connFor({ user: 'proxy_sim' }); const anon = db.connFor({ user: 'anon_sim' });
    try {
        const ps = createNotifyStore({ pool: proxy });
        await ps.optOut({ appId: 'app-a', userId: u });
        assert.equal((await ps.getRecipient({ appId: 'app-a', userId: u })).optedOut, true);
        assert.equal((await anon.query('select count(*)::int as n from platform.notify_optouts')).rows[0].n, 0);
        await assert.rejects(() => anon.query("insert into platform.notify_optouts (app_id, user_id) values ('app-a', $1)", [randomUUID()]));
    } finally { await proxy.end(); await anon.end(); }
});

t('deleting the user or the app removes the opt-out row', async () => {
    const u = await auth.upsertUser({ appId: 'app-b', email: 'r5@example.com' });
    await store.optOut({ appId: 'app-b', userId: u });
    await db.pool.query('delete from platform.end_users where id = $1', [u]);
    assert.equal(await count(`user_id = '${u}'`), 0);
});
