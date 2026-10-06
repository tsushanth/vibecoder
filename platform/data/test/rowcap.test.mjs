import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDb, ROW_CAP_MESSAGE } from '../routes.js';

const SPEC = { version: 1, tables: { notes: { access: 'owner', columns: { body: { type: 'text' } } }, tags: { access: 'owner', columns: { name: { type: 'text' } } } } };
const mk = ({ total = 0, throwTotal = false } = {}) => {
    const calls = { total: [], run: 0 };
    const executor = {
        async currentSpec() { return { spec: SPEC, version: 1 }; }, async ensure() { return 'apps_00000000000000000000'; },
        async totalRows(appId, tables) { calls.total.push(tables); if (throwTotal) throw new Error('db'); return total; },
        async run() { calls.run++; return { ok: true, rows: [{ id: 1 }] }; },
    };
    return { executor, calls, auth: { async verifySession() { return { ok: true, user: { id: '11111111-1111-4111-8111-111111111111' } }; } } };
};
const ins = (n) => ({ op: 'insert', table: 'notes', rows: Array.from({ length: n }, (_, i) => ({ body: `b${i}` })) });
const run = (ctx, body, limitsFor = async () => ({ rowCap: 100 })) => handleDb({ body, bearer: 'tok', appId: 'a', auth: ctx.auth, executor: ctx.executor, limitsFor });

test('an insert under the cap runs; the count covers every table in the spec', async () => {
    const c = mk({ total: 90 });
    const r = await run(c, ins(10));
    assert.equal(r.status, 200); assert.equal(c.calls.run, 1);
    assert.deepEqual(c.calls.total[0], ['notes', 'tags']);
});

test('an insert that would pass the cap is refused with 413 row_cap, a short message, and never reaches the database', async () => {
    const c = mk({ total: 91 });
    const r = await run(c, ins(10));
    assert.equal(r.status, 413); assert.equal(r.body.error, 'row_cap'); assert.equal(r.body.message, ROW_CAP_MESSAGE(100));
    assert.ok(r.body.message.length < 160);
    assert.equal(c.calls.run, 0);
});

test('already at the cap: even one more row is refused; reads, updates and deletes are not counted or blocked', async () => {
    const c = mk({ total: 100 });
    assert.equal((await run(c, ins(1))).status, 413);
    assert.equal((await run(c, { op: 'select', table: 'notes' })).status, 200);
    assert.equal(c.calls.total.length, 1);
    await run(c, { op: 'delete', table: 'notes', where: [{ col: 'id', op: 'eq', val: 1 }] });
    assert.equal(c.calls.total.length, 1);
});

test('the cap comes from limitsFor per app, so an override raises or lowers it', async () => {
    assert.equal((await run(mk({ total: 150 }), ins(1), async () => ({ rowCap: 1000 }))).status, 200);
    assert.equal((await run(mk({ total: 5 }), ins(1), async () => ({ rowCap: 5 }))).status, 413);
});

test('fails closed: if the count cannot be taken the insert is refused with 503, not allowed', async () => {
    const c = mk({ throwTotal: true });
    const r = await run(c, ins(1));
    assert.equal(r.status, 503); assert.equal(r.body.error, 'limits_unavailable'); assert.equal(c.calls.run, 0);
});

test('fails closed when the limits themselves cannot be read', async () => {
    const c = mk();
    const r = await run(c, ins(1), async () => { throw new Error('x'); });
    assert.equal(r.status, 503); assert.equal(c.calls.run, 0);
});

test('without limitsFor no cap applies (callers that have not opted in keep working)', async () => {
    const c = mk({ total: 1e9 });
    assert.equal((await handleDb({ body: ins(1), bearer: 'tok', appId: 'a', auth: c.auth, executor: c.executor })).status, 200);
});
