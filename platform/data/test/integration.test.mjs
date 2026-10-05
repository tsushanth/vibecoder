import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createDataExecutor, isSafeStatement } from '../executor.js';
import { validateSpec } from '../schema.js';
import { buildQuery } from '../query.js';

// The query builder's real output, run through the real executor on real Postgres, for every column type and access mode.
const RAW = { version: 1, tables: {
    items: { access: 'owner', columns: { title: { type: 'text', required: true }, qty: { type: 'integer', default: 1 }, price: { type: 'number' }, done: { type: 'boolean', default: false }, due: { type: 'timestamp' }, meta: { type: 'json' } }, indexes: [['done']] },
    posts: { access: 'public_read', columns: { body: { type: 'text', required: true } } },
    board: { access: 'authenticated', columns: { note: { type: 'text', required: true } } },
    secrets: { access: 'private', columns: { v: { type: 'text' } } },
    stamped: { access: 'owner', columns: { at: { type: 'timestamp', default: 'now' }, label: { type: 'text' } } },
} };
let db, skip, pool, ex, schema, spec;
const APP = 'integ-app';
const U1 = randomUUID(), U2 = randomUUID();
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    await db.admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname='proxy_sim') then create role proxy_sim login in role vibe_proxy; end if; end $$");
    const stores = createPgStores({ pool: db.pool, masterKey: masterKey() }); await stores.upsertApp({ appId: APP, enabled: true });
    pool = db.connFor({ user: 'proxy_sim', max: 4 }); ex = createDataExecutor({ pool, timeoutMs: 3000 });
    spec = validateSpec(RAW).spec; schema = await ex.ensure(APP);
    const r = await ex.applySchema({ appId: APP, spec }); assert.equal(r.ok, true);
    // owners need end_users rows? user_id has no FK in per-app tables, so any uuid works
});
after(async () => { await pool?.end().catch(() => {}); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });
const go = async (request, userId = null) => {
    const b = buildQuery({ spec, schemaName: schema, request, userId });
    if (!b.ok) return { built: false, ...b };
    assert.equal(isSafeStatement(b.text), true, `executor guard refuses builder output: ${b.text}`);
    return { built: true, ...(await ex.run(APP, b)) };
};

t('insert fills defaults and handles every column type; the row comes back', async () => {
    const r = await go({ op: 'insert', table: 'items', rows: [{ title: 'milk', price: 2.5, due: '2026-10-05T12:00:00Z', meta: { a: [1, 2] } }] }, U1);
    assert.equal(r.ok, true, JSON.stringify(r));
    const row = r.rows[0]; assert.equal(row.title, 'milk'); assert.equal(Number(row.qty), 1); assert.equal(row.done, false); assert.equal(Number(row.price), 2.5);
    assert.equal(new Date(row.due).toISOString(), '2026-10-05T12:00:00.000Z'); assert.deepEqual(row.meta, { a: [1, 2] }); assert.equal(row.user_id, U1); assert.ok(row.id && row.created_at);
});

t('required columns, wrong types and timestamp defaults behave', async () => {
    assert.deepEqual((await go({ op: 'insert', table: 'items', rows: [{ qty: 3 }] }, U1)).code, 'missing_required');
    const s = await go({ op: 'insert', table: 'stamped', rows: [{ label: 'x' }] }, U1); assert.equal(s.ok, true, JSON.stringify(s)); assert.ok(Date.now() - new Date(s.rows[0].at) < 60000);
    assert.equal((await go({ op: 'insert', table: 'items', rows: [{ title: 'x', qty: 1.5 }] }, U1)).built, false);
});

t('select: filters, ordering, paging, in/like/is_null, and bigint comes back usable', async () => {
    await go({ op: 'insert', table: 'items', rows: [{ title: 'a', qty: 5 }, { title: 'b', qty: 10, done: true }, { title: 'c', qty: 7 }] }, U2);
    const all = await go({ op: 'select', table: 'items', order: [{ col: 'qty', dir: 'desc' }] }, U2); assert.deepEqual(all.rows.map((r) => r.title), ['b', 'c', 'a']);
    assert.deepEqual((await go({ op: 'select', table: 'items', where: [{ col: 'qty', op: 'gte', val: 7 }], order: [{ col: 'title', dir: 'asc' }] }, U2)).rows.map((r) => r.title), ['b', 'c']);
    assert.deepEqual((await go({ op: 'select', table: 'items', where: [{ col: 'title', op: 'in', val: ['a', 'c'] }], order: [{ col: 'title', dir: 'asc' }] }, U2)).rows.map((r) => r.title), ['a', 'c']);
    assert.equal((await go({ op: 'select', table: 'items', where: [{ col: 'title', op: 'ilike', val: 'B%' }] }, U2)).rows.length, 1);
    assert.equal((await go({ op: 'select', table: 'items', where: [{ col: 'price', op: 'is_null', val: true }] }, U2)).rows.length, 3);
    assert.equal((await go({ op: 'select', table: 'items', limit: 1, offset: 1, order: [{ col: 'title', dir: 'asc' }] }, U2)).rows[0].title, 'b');
    assert.equal((await go({ op: 'select', table: 'items', columns: ['title'] }, U2)).rows[0].qty, undefined);
    assert.equal((await go({ op: 'select', table: 'items', where: [{ col: 'done', op: 'eq', val: true }] }, U2)).rows[0].title, 'b');
});

t('owner tables: each user sees and changes only their own rows; anonymous is refused', async () => {
    assert.equal((await go({ op: 'select', table: 'items' }, U1)).rows.every((r) => r.user_id === U1), true);
    assert.equal((await go({ op: 'select', table: 'items' }, null)).status, 401);
    const mine = (await go({ op: 'select', table: 'items', where: [{ col: 'title', op: 'eq', val: 'a' }] }, U2)).rows[0];
    const other = await go({ op: 'update', table: 'items', where: [{ col: 'id', op: 'eq', val: mine.id }], set: { title: 'hacked' } }, U1); assert.equal(other.rows.length, 0);
    assert.equal((await go({ op: 'delete', table: 'items', where: [{ col: 'id', op: 'eq', val: mine.id }] }, U1)).rows.length, 0);
    const upd = await go({ op: 'update', table: 'items', where: [{ col: 'id', op: 'eq', val: mine.id }], set: { title: 'a2', done: true } }, U2); assert.equal(upd.rows[0].title, 'a2');
    assert.equal((await go({ op: 'delete', table: 'items', where: [{ col: 'id', op: 'eq', val: mine.id }] }, U2)).rows.length, 1);
});

t('a client cannot write or filter its way into another user\'s rows or forge the owner', async () => {
    assert.equal((await go({ op: 'insert', table: 'items', rows: [{ title: 'x', user_id: U1 }] }, U2)).built, false);
    assert.equal((await go({ op: 'update', table: 'items', where: [{ col: 'qty', op: 'gt', val: 0 }], set: { user_id: U2 } }, U1)).built, false);
    const spoof = await go({ op: 'select', table: 'items', where: [{ col: 'user_id', op: 'eq', val: U2 }] }, U1); assert.equal(spoof.rows.length, 0);
    const wide = await go({ op: 'update', table: 'items', where: [{ col: 'qty', op: 'gte', val: 0 }], set: { done: true } }, U1); assert.equal(wide.rows.every((r) => r.user_id === U1), true);
    assert.equal((await go({ op: 'select', table: 'items' }, U2)).rows.length >= 1, true);
});

t('public_read, authenticated and private access modes', async () => {
    const p = await go({ op: 'insert', table: 'posts', rows: [{ body: 'hello' }] }, U1); assert.equal(p.ok, true);
    assert.equal((await go({ op: 'select', table: 'posts' }, null)).rows.length, 1); assert.equal((await go({ op: 'select', table: 'posts' }, U2)).rows.length, 1);
    assert.equal((await go({ op: 'insert', table: 'posts', rows: [{ body: 'x' }] }, null)).status, 401);
    assert.equal((await go({ op: 'update', table: 'posts', where: [{ col: 'body', op: 'eq', val: 'hello' }], set: { body: 'x' } }, U2)).rows.length, 0);
    await go({ op: 'insert', table: 'board', rows: [{ note: 'n1' }] }, U1);
    assert.equal((await go({ op: 'select', table: 'board' }, U2)).rows.length, 1); assert.equal((await go({ op: 'select', table: 'board' }, null)).status, 401);
    assert.equal((await go({ op: 'select', table: 'secrets' }, U1)).status, 403);
});

t('everything the builder emits stays inside the app schema, even with hostile values', async () => {
    for (const val of ["'; drop table items; --", '" or 1=1 --', '\\', '%', '\u0000'.slice(1), 'a'.repeat(200)]) {
        const r = await go({ op: 'select', table: 'items', where: [{ col: 'title', op: 'like', val }] }, U1);
        if (val === '\\') assert.deepEqual([r.ok, r.status, r.code], [false, 400, 'invalid_value']); // a trailing escape is the caller's mistake, not a server fault
        else if (r.built) assert.equal(r.ok, true, JSON.stringify(r));
        const i = await go({ op: 'insert', table: 'items', rows: [{ title: val.slice(0, 300) }] }, U1); if (i.built) assert.equal(i.ok, true, JSON.stringify(i));
    }
    assert.equal((await db.pool.query(`select count(*)::int n from pg_tables where schemaname = '${schema}'`)).rows[0].n, 5);
    assert.equal((await go({ op: 'select', table: 'items', where: [{ col: 'title', op: 'eq', val: "'; drop table items; --" }] }, U1)).rows.length, 1);
});
