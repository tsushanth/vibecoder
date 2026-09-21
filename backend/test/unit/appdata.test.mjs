import './../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const A = await import('../../routes/appdata.routes.js');
const { validAppId, validCollection, validKey, validateValue, createRateLimiter, createSupabaseStore, createSupabaseOriginResolver, LIMITS, BASE_DOMAIN } = A;

test('validAppId', () => {
    for (const ok of ['my-app', 'ab1', 'a'.repeat(62), 'x9-y']) assert.equal(validAppId(ok), true, ok);
    for (const bad of ['a', 'ab', '-ab', 'ab-', 'A-b', 'a_b', 'a.b', 'a'.repeat(63), '', null, 'sdk.js', '../x', 'a b'])
        assert.equal(validAppId(bad), false, String(bad));
});
test('validCollection / validKey', () => {
    assert.equal(validCollection('_vb_e2e'), true);
    assert.equal(validCollection('a'.repeat(64)), true);
    for (const bad of ['', 'a'.repeat(65), 'a.b', 'a/b', 'a b', null]) assert.equal(validCollection(bad), false, String(bad));
    for (const ok of ['k', 'a.b:c-d_e', 'a'.repeat(128), '..a', 'a..']) assert.equal(validKey(ok), true, ok);
    for (const bad of ['', '.', '..', 'a'.repeat(129), 'a/b', 'a b', 'a?b', null]) assert.equal(validKey(bad), false, String(bad));
});
test('validateValue size boundary (bytes, not chars) and errors', () => {
    assert.equal(validateValue(undefined).ok, false);
    assert.equal(validateValue(null).ok, true);
    assert.equal(validateValue({ a: 1 }).size, 7);
    const exactly = 'x'.repeat(LIMITS.maxValueBytes - 2); // +2 quotes
    assert.equal(validateValue(exactly).ok, true);
    const over = validateValue(exactly + 'x');
    assert.equal(over.ok, false); assert.equal(over.status, 413);
    // multibyte: 11k emoji-ish chars is > 32KB in UTF-8 but < 32K chars
    assert.equal(validateValue('€'.repeat(11000)).ok, false);
    const cyc = {}; cyc.self = cyc;
    assert.match(validateValue(cyc).error, /serialisable/);
});
test('rate limiter: allows max then returns retry-after; separate keys; window reset', () => {
    const hit = createRateLimiter();
    for (let i = 0; i < 3; i++) assert.equal(hit('k', 3), 0);
    const wait = hit('k', 3);
    assert.ok(wait >= 1 && wait <= 60);
    assert.equal(hit('other', 3), 0);
    assert.equal(hit('short', 1, 1), 0);
    return new Promise((r) => setTimeout(() => { assert.equal(hit('short', 1, 1), 0); r(); }, 5));
});

// ---- store quota logic against a fake supabase client ----
function fakeDb(handlers) {
    const calls = [];
    const chain = (table) => {
        const q = { table, eq: [], ops: [] };
        const b = new Proxy({}, { get(_t, p) {
            if (p === 'then') return (res, rej) => Promise.resolve(handlers[table]?.(q) ?? { data: [], error: null }).then(res, rej);
            if (p === 'maybeSingle') return () => Promise.resolve(handlers[table]?.(q) ?? { data: null, error: null });
            return (...a) => { q.ops.push([p, ...a]); if (p === 'eq') q.eq.push(a); return b; };
        } });
        calls.push(q); return b;
    };
    return { calls, from: chain, rpc: (name, args) => Promise.resolve(handlers.rpc(name, args)) };
}

test('store.put passes quota limits to the RPC and returns its verdict', async () => {
    let seen;
    const db = fakeDb({ rpc: (n, a) => { seen = [n, a]; return { data: 'max_keys', error: null }; } });
    const s = createSupabaseStore(db);
    assert.equal(await s.put('app', 'c', 'k', { a: 1 }, 7), 'max_keys');
    assert.equal(seen[0], 'app_data_put');
    assert.deepEqual([seen[1].p_max_keys, seen[1].p_max_total, seen[1].p_size], [1000, 5 * 1024 * 1024, 7]);
});
test('store propagates errors; collectionCount counts distinct collections', async () => {
    const s = createSupabaseStore(fakeDb({
        rpc: () => ({ data: null, error: new Error('rpc down') }),
        app_data: () => ({ data: [{ collection: 'a' }, { collection: 'a' }, { collection: 'b' }], error: null }),
    }));
    await assert.rejects(s.put('a', 'c', 'k', 1, 1), /rpc down/);
    assert.equal(await s.collectionCount('app'), 2);
    assert.equal(await s.collectionExists('app', 'a'), true);
});
test('store.list applies prefix range and after cursor, maps rows', async () => {
    const db = fakeDb({ app_data: () => ({ data: [{ key: 'a1', value: 1, updated_at: 't' }], error: null }) });
    const rows = await createSupabaseStore(db).list('app', 'c', { prefix: 'a', limit: 5, after: 'a0' });
    assert.deepEqual(rows, [{ key: 'a1', value: 1, updatedAt: 't' }]);
    const ops = db.calls[0].ops.map((o) => o[0]);
    assert.ok(ops.includes('gte') && ops.includes('lt') && ops.includes('gt'));
    assert.deepEqual(db.calls[0].ops.find((o) => o[0] === 'limit'), ['limit', 6]);
});

test('origin resolver: active deployment + verified custom domains, unknown app, inactive, cache, missing table', async () => {
    let depCalls = 0;
    const mk = (dep, doms) => fakeDb({
        deployments: () => { depCalls++; return { data: dep, error: null }; },
        custom_domains: () => doms,
    });
    let r = createSupabaseOriginResolver(mk({ id: 'd1', status: 'active' }, { data: [{ domain: 'MyApp.Example.COM' }], error: null }));
    const o = await r('foo-app');
    assert.deepEqual([...o].sort(), [`https://foo-app.${BASE_DOMAIN}`, 'https://myapp.example.com'].sort());
    await r('foo-app'); assert.equal(depCalls, 1, 'cached');

    assert.equal(await createSupabaseOriginResolver(mk(null, { data: [] }))('nope'), null);
    assert.equal(await createSupabaseOriginResolver(mk({ id: 'd', status: 'stopped' }, { data: [] }))('x-y'), null);
    const missing = await createSupabaseOriginResolver(mk({ id: 'd', status: 'active' }, { data: null, error: { code: '42P01', message: 'relation does not exist' } }))('ab-c');
    assert.deepEqual([...missing], [`https://ab-c.${BASE_DOMAIN}`]);
    await assert.rejects(createSupabaseOriginResolver(mk({ id: 'd', status: 'active' }, { data: null, error: { code: 'XX', message: 'boom' } }))('ab-c'), (e) => e.message === 'boom');
    assert.equal(await createSupabaseOriginResolver(mk(null, {}), 0)('ab-c'), null);
});
