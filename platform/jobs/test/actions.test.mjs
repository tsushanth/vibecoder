import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { createPgStores } from '../../store/pg.js';
import { createDataExecutor } from '../../data/executor.js';
import { validateSpec } from '../../data/schema.js';
import { createLimiter, memoryStore } from '../../vibe-proxy/limits.js';
import { createMeter } from '../../vibe-proxy/meter.js';
import { resolvePointer, coerce, buildInsert, buildPrune, createActionRunner, PRUNE_BATCH, PRUNE_MAX_BATCHES } from '../actions.js';

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const SPEC = validateSpec({ version: 1, tables: {
    readings: { access: 'public_read', columns: { temp: { type: 'number' }, note: { type: 'text' }, n: { type: 'integer' }, flag: { type: 'boolean' }, ts: { type: 'timestamp' }, meta: { type: 'json' } } },
    strict: { access: 'private', columns: { name: { type: 'text', required: true }, tag: { type: 'text', required: true, default: 'none' } } },
} }).spec;
const tables = SPEC.tables;

let db, skip, proxyPool, ex, stores, store, limiter, events, fetchLog, respond;
before(async () => {
    db = await scratchDb(); if (db.unavailable) { skip = db.unavailable; return; }
    await db.admin.query("do $$ begin if not exists (select 1 from pg_roles where rolname='proxy_sim') then create role proxy_sim login in role vibe_proxy; end if; end $$");
    stores = createPgStores({ pool: db.pool, masterKey: masterKey() });
    await stores.upsertApp({ appId: 'job-a', enabled: true, manifest: { connectors: { feed: { host: 'feed.example.com', paths: ['/v1/*'], methods: ['GET'], secret: { name: 'FEED_KEY', in: 'header', field: 'x-api-key' } }, evil: { host: 'evil.example.com', paths: ['/x'], methods: ['GET'] } } } });
    await stores.upsertApp({ appId: 'job-b', enabled: true });
    await stores.upsertApp({ appId: 'job-off', enabled: false });
    await stores.secretStore.set('job-a', 'FEED_KEY', 'sk-feed-SECRETVALUE-123456');
    proxyPool = db.connFor({ user: 'proxy_sim', max: 5 });
    ex = createDataExecutor({ pool: proxyPool, timeoutMs: 4000 });
    for (const a of ['job-a', 'job-b']) assert.equal((await ex.applySchema({ appId: a, spec: SPEC })).ok, true);
    store = { getSpec: async (appId) => (await ex.currentSpec(appId)).spec };
    limiter = createLimiter({ store: memoryStore(), perIpPerMin: 1000, perAppPerMin: 1000 });
});
after(async () => { await proxyPool?.end().catch(() => {}); if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); events = []; fetchLog = []; respond = () => ({ status: 200, body: {} }); for (const a of ['job-a', 'job-b']) for (const n of ['readings', 'strict']) await owner(`truncate ${await tbl(a, n)}`); await f(c); });

const fetchImpl = async (url, init) => {
    fetchLog.push({ url: String(url), headers: Object.fromEntries(init.headers.entries()), method: init.method });
    const r = respond(String(url));
    if (r.redirect) return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/' } });
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
const mk = (over = {}) => createActionRunner({
    appStore: stores.appStore, secretStore: stores.secretStore, limiter, meter: createMeter({ sink: async (e) => { events.push(e); } }),
    fetchImpl, resolve: async () => ['93.184.216.34'], runQuery: (appId, qq) => ex.run(appId, qq), getSpec: store.getSpec, now: () => NOW, ...over,
});
const owner = async (sql, vals = []) => (await db.pool.query(sql, vals)).rows;
const tbl = async (appId, name) => { const s = (await owner('select schema_name from platform.app_dbs where app_id = $1', [appId]))[0].schema_name; return `"${s}"."${name}"`; };
const conn = (o = {}) => ({ type: 'connector', connector: 'nws', method: 'GET', path: '/alerts/active', query: { area: 'CA' }, save: { table: 'readings', map: { temp: '/p/temp', note: '/p/note' } }, ...o });

// ---------- pure helpers ----------
test('resolvePointer follows RFC 6901 and only own properties', () => {
    const doc = { a: { 'b/c': 1, 'd~e': 2, list: [{ x: 'first' }, { x: 'second' }] }, '': 'empty', z: null };
    assert.deepEqual(resolvePointer(doc, '/a/b~1c'), { found: true, value: 1 });
    assert.deepEqual(resolvePointer(doc, '/a/d~0e'), { found: true, value: 2 });
    assert.deepEqual(resolvePointer(doc, '/a/list/1/x'), { found: true, value: 'second' });
    assert.deepEqual(resolvePointer(doc, '/a/list/0/x'), { found: true, value: 'first' });
    assert.deepEqual(resolvePointer(doc, '/'), { found: true, value: 'empty' });
    assert.deepEqual(resolvePointer(doc, '/z'), { found: true, value: null });
    for (const p of ['/a/list/2', '/a/list/01', '/a/list/-1', '/a/list/x', '/nope', '/a/b~1c/deeper', 'a', '', null, '/a/list/1e0', '/a/list/9999999999']) assert.equal(resolvePointer(doc, p).found, false, String(p));
    for (const p of ['/__proto__', '/constructor', '/constructor/name', '/toString', '/a/__proto__', '/a/list/length', '/a/list/constructor']) assert.equal(resolvePointer(doc, p).found, false, p);
    assert.deepEqual(resolvePointer(JSON.parse('{"__proto__":{"x":1}}'), '/__proto__/x'), { found: true, value: 1 }, 'a real own key named __proto__ in parsed JSON is just data');
});

test('coerce converts per column type and refuses what it cannot', () => {
    assert.deepEqual(coerce('text', 'hi'), { ok: true, value: 'hi' });
    assert.deepEqual(coerce('text', 5), { ok: true, value: '5' });
    assert.deepEqual(coerce('text', false), { ok: true, value: 'false' });
    assert.equal(coerce('text', { a: 1 }).code, 'bad_type');
    assert.equal(coerce('text', ['x']).code, 'bad_type');
    assert.equal(coerce('text', 'x'.repeat(10_000)).ok, true);
    assert.equal(coerce('text', 'x'.repeat(10_001)).code, 'value_too_large');
    assert.deepEqual(coerce('integer', 7), { ok: true, value: 7 });
    assert.deepEqual(coerce('integer', '-12'), { ok: true, value: -12 });
    for (const v of [1.5, '1.5', '1e3', NaN, 2 ** 60, '9999999999999999', true, null, '']) assert.equal(coerce('integer', v).ok, false, String(v));
    assert.deepEqual(coerce('number', 1.5), { ok: true, value: 1.5 });
    assert.deepEqual(coerce('number', '21.5'), { ok: true, value: 21.5 });
    assert.deepEqual(coerce('number', '-2e3'), { ok: true, value: -2000 });
    for (const v of ['abc', NaN, Infinity, '', '1.', true, {}]) assert.equal(coerce('number', v).ok, false, String(v));
    assert.deepEqual(coerce('boolean', true), { ok: true, value: true });
    assert.deepEqual(coerce('boolean', 'false'), { ok: true, value: false });
    assert.deepEqual(coerce('boolean', 'true'), { ok: true, value: true });
    for (const v of ['yes', 1, 0, 'TRUE', null]) assert.equal(coerce('boolean', v).ok, false, String(v));
    assert.deepEqual(coerce('timestamp', '2026-10-05T10:00:00Z'), { ok: true, value: '2026-10-05T10:00:00.000Z' });
    for (const v of ['nope', 1728122400000, '2026-10-05T10:00:00Z' + ' '.repeat(40), null, {}]) assert.equal(coerce('timestamp', v).ok, false, String(v).slice(0, 20));
    assert.deepEqual(coerce('json', { a: [1] }), { ok: true, value: '{"a":[1]}' });
    assert.deepEqual(coerce('json', 'str'), { ok: true, value: '"str"' });
    assert.equal(coerce('json', { a: 'x'.repeat(10_001) }).code, 'value_too_large');
    assert.equal(coerce('json', undefined).ok, false);
    assert.equal(coerce('unknown', 'x').code, 'bad_type');
});

test('buildInsert quotes identifiers, binds values and checks every name against the schema', () => {
    const r = buildInsert({ save: { table: 'readings', map: { temp: '/t', note: '/n' } }, json: { t: 3, n: 'hi' }, tables });
    assert.deepEqual(r, { ok: true, text: 'insert into "readings" ("temp", "note") values ($1, $2)', values: [3, 'hi'] });
    const evil = [
        { table: 'readings"; drop table x;--', map: { temp: '/t' } },
        { table: 'nope', map: { temp: '/t' } },
        { table: 'constructor', map: { temp: '/t' } },
        { table: 'readings', map: { 'temp"': '/t' } },
        { table: 'readings', map: { id: '/t' } },
        { table: 'readings', map: { user_id: '/t' } },
        { table: 'readings', map: { created_at: '/t' } },
        { table: 'readings', map: { ghost: '/t' } },
        { table: 'readings', map: { constructor: '/t' } },
        { table: 'readings', map: { __proto__x: '/t' } },
        { table: undefined, map: {} },
    ];
    for (const save of evil) assert.deepEqual(buildInsert({ save, json: { t: 1 }, tables }), { ok: false, code: 'schema_mismatch' }, JSON.stringify(save));
    assert.equal(buildInsert({ save: { table: 'readings', map: { temp: '/t' } }, json: { t: 1 }, tables: null }).code, 'schema_mismatch');
});

test('buildInsert: missing and null values follow the column rules', () => {
    const save = { table: 'strict', map: { name: '/name', tag: '/tag' } };
    assert.deepEqual(buildInsert({ save, json: { name: 'a' }, tables }), { ok: true, text: 'insert into "strict" ("name") values ($1)', values: ['a'] }, 'null for a column with a default lets the default apply');
    assert.deepEqual(buildInsert({ save, json: { name: 'a', tag: null }, tables }).values, ['a']);
    assert.equal(buildInsert({ save, json: { tag: 'x' }, tables }).code, 'missing_field', 'required without default');
    assert.equal(buildInsert({ save, json: { name: null }, tables }).code, 'missing_field');
    assert.equal(buildInsert({ save: { table: 'strict', map: { tag: '/tag' } }, json: { tag: 'x' }, tables }).code, 'missing_field', 'required column not in the map at all');
    const loose = buildInsert({ save: { table: 'readings', map: { temp: '/t', note: '/n' } }, json: { t: 1 }, tables });
    assert.deepEqual(loose.values, [1, null], 'optional missing value stores null');
    assert.equal(buildInsert({ save: { table: 'readings', map: { temp: '/zz' } }, json: {}, tables }).ok, true, 'all-null optional row is still one row');
    assert.equal(buildInsert({ save: { table: 'readings', map: { temp: '/t' } }, json: { t: 'abc' }, tables }).code, 'bad_type');
});

test('buildInsert refuses a row where every mapped column was left to its default', () => {
    const tb = { t: { columns: { a: { type: 'text', default: 'x' } } } };
    assert.equal(buildInsert({ save: { table: 't', map: { a: '/a' } }, json: {}, tables: tb }).code, 'missing_field');
});

test('buildPrune: cutoff from the injected clock, bounded batch, schema-checked', () => {
    const r = buildPrune({ table: 'readings', olderThanDays: 30, nowMs: NOW, tables });
    assert.equal(r.ok, true);
    assert.equal(r.values[0], new Date(NOW - 30 * 86_400_000).toISOString());
    assert.match(r.text, /^delete from "readings" where "id" in \(select "id" from "readings" where "created_at" < \$1::timestamptz order by "created_at" limit 500\) returning "id"$/);
    assert.equal(PRUNE_BATCH, 500);
    for (const table of ['nope', 'x"; drop', undefined, 'constructor']) assert.equal(buildPrune({ table, olderThanDays: 1, nowMs: NOW, tables }).code, 'schema_mismatch', String(table));
});

// ---------- connector -> row with the real executor and a fake fetch ----------
t('connector job saves one typed row in the app schema through the executor', async () => {
    respond = () => ({ status: 200, body: { p: { temp: '21.5', note: 'sunny', n: 3, flag: 'true', ts: '2026-10-05T10:00:00Z', meta: { a: [1, 2] }, list: [{ v: 9 }] } } });
    const action = conn({ save: { table: 'readings', map: { temp: '/p/temp', note: '/p/note', n: '/p/n', flag: '/p/flag', ts: '/p/ts', meta: '/p/meta' } } });
    const r = await mk()({ appId: 'job-a', action });
    assert.deepEqual(r, { ok: true, rows: 1 });
    const rows = await owner(`select temp, note, n, flag, ts, meta, user_id from ${await tbl('job-a', 'readings')}`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].temp, 21.5); assert.equal(rows[0].note, 'sunny'); assert.equal(rows[0].n, '3'); assert.equal(rows[0].flag, true);
    assert.equal(rows[0].ts.toISOString(), '2026-10-05T10:00:00.000Z'); assert.deepEqual(rows[0].meta, { a: [1, 2] }); assert.equal(rows[0].user_id, null);
    assert.equal((await owner(`select count(*)::int n from ${await tbl('job-b', 'readings')}`))[0].n, 0, 'the other app is untouched');
});

t('the call goes through the platform proxy path: built-in host, query, GET, platform headers, metering', async () => {
    respond = () => ({ status: 200, body: { p: { temp: 1 } } });
    await mk()({ appId: 'job-a', action: conn({ query: { area: 'CA', limit: 5 } }) });
    assert.equal(fetchLog.length, 1);
    assert.equal(fetchLog[0].url, 'https://api.weather.gov/alerts/active?area=CA&limit=5');
    assert.equal(fetchLog[0].method, 'GET');
    assert.equal(fetchLog[0].headers['user-agent'], 'VibeBuild vibe-proxy/1.0');
    assert.equal(events.length, 1);
    assert.deepEqual([events[0].appId, events[0].connector, events[0].status, events[0].outcome], ['job-a', 'nws', 200, 'ok']);
});

t('a manifest connector attaches its secret server side and the secret never reaches the table', async () => {
    respond = () => ({ status: 200, body: { echo: 'key was sk-feed-SECRETVALUE-123456', p: { note: 'sk-feed-SECRETVALUE-123456' } } });
    const r = await mk()({ appId: 'job-a', action: conn({ connector: 'feed', path: '/v1/data', query: undefined, save: { table: 'readings', map: { note: '/p/note' } } }) });
    assert.equal(r.ok, true);
    assert.equal(fetchLog[0].headers['x-api-key'], 'sk-feed-SECRETVALUE-123456');
    const stored = await owner(`select note from ${await tbl('job-a', 'readings')}`);
    assert.equal(stored[0].note, '[REDACTED]');
    assert.ok(!JSON.stringify(events).includes('SECRETVALUE'));
});

t('a missing secret fails with secret_missing', async () => {
    await stores.secretStore.delete('job-a', 'FEED_KEY');
    try {
        const r = await mk()({ appId: 'job-a', action: conn({ connector: 'feed', path: '/v1/data', query: undefined }) });
        assert.deepEqual(r, { ok: false, code: 'secret_missing' }); assert.equal(fetchLog.length, 0);
    } finally { await stores.secretStore.set('job-a', 'FEED_KEY', 'sk-feed-SECRETVALUE-123456'); }
});

t('SSRF, allowlist and redirect protections apply to jobs', async () => {
    let r = await mk({ resolve: async () => ['10.0.0.5'] })({ appId: 'job-a', action: conn({ connector: 'evil', path: '/x', query: undefined }) });
    assert.deepEqual(r, { ok: false, code: 'blocked_host' });
    r = await mk()({ appId: 'job-a', action: conn({ path: '/admin/secrets' }) });
    assert.deepEqual(r, { ok: false, code: 'path_not_allowed' });
    r = await mk()({ appId: 'job-a', action: conn({ connector: 'ghost' }) });
    assert.deepEqual(r, { ok: false, code: 'unknown_connector' });
    respond = () => ({ redirect: true });
    r = await mk()({ appId: 'job-a', action: conn() });
    assert.deepEqual(r, { ok: false, code: 'redirect_blocked' });
    assert.ok(fetchLog.every((f) => !f.url.includes('169.254')));
    assert.equal((await owner(`select count(*)::int n from ${await tbl('job-a', 'readings')}`))[0].n, 0);
});

t('upstream errors give a code only: the response body and any text in it never appear in the result', async () => {
    respond = () => ({ status: 500, body: { error: 'LEAKY upstream stack trace password=hunter2' } });
    let r = await mk()({ appId: 'job-a', action: conn() });
    assert.deepEqual(r, { ok: false, code: 'upstream_500' });
    respond = () => ({ status: 404, body: { error: 'upstream_timeout' } });
    r = await mk()({ appId: 'job-a', action: conn() });
    assert.equal(r.ok, false); assert.match(r.code, /^[a-z0-9_]+$/);
    respond = () => ({ status: 200, body: '<html>not json LEAKY</html>' });
    r = await mk()({ appId: 'job-a', action: conn() });
    assert.deepEqual(r, { ok: false, code: 'bad_json' });
    assert.ok(!JSON.stringify(r).includes('LEAKY'));
});

t('mapping problems are failures with a code: missing required field, wrong type, oversize value', async () => {
    respond = () => ({ status: 200, body: { name: 'x', p: { temp: 'abc' }, big: 'y'.repeat(10_001) } });
    let r = await mk()({ appId: 'job-a', action: conn({ save: { table: 'readings', map: { temp: '/p/temp' } } }) });
    assert.deepEqual(r, { ok: false, code: 'bad_type' });
    r = await mk()({ appId: 'job-a', action: conn({ save: { table: 'readings', map: { note: '/big' } } }) });
    assert.deepEqual(r, { ok: false, code: 'value_too_large' });
    r = await mk()({ appId: 'job-a', action: conn({ save: { table: 'strict', map: { name: '/nothing' } } }) });
    assert.deepEqual(r, { ok: false, code: 'missing_field' });
    assert.equal((await owner(`select count(*)::int n from ${await tbl('job-a', 'readings')}`))[0].n, 0);
});

t('a table or column the schema no longer has is schema_mismatch and no request is made for a missing table', async () => {
    let r = await mk()({ appId: 'job-a', action: conn({ save: { table: 'gone', map: { x: '/x' } } }) });
    assert.deepEqual(r, { ok: false, code: 'schema_mismatch' }); assert.equal(fetchLog.length, 0);
    respond = () => ({ status: 200, body: { x: 1 } });
    r = await mk()({ appId: 'job-a', action: conn({ save: { table: 'readings', map: { ghostcol: '/x' } } }) });
    assert.deepEqual(r, { ok: false, code: 'schema_mismatch' });
    r = await mk()({ appId: 'job-b', action: conn({ save: { table: 'readings', map: { temp: '/x' } } }) });
    assert.equal(r.ok, true);
    await stores.upsertApp({ appId: 'job-nodb', enabled: true });
    r = await mk()({ appId: 'job-nodb', action: conn() });
    assert.deepEqual(r, { ok: false, code: 'schema_mismatch' }, 'an app with no data schema has nowhere to save');
});

t('disabled apps, the kill switch and rate limits skip the run without it being a failure', async () => {
    let r = await mk()({ appId: 'job-off', action: conn() });
    assert.deepEqual(r, { ok: false, skipped: true, code: 'app_disabled' }); assert.equal(fetchLog.length, 0);
    r = await mk()({ appId: 'ghost-app', action: { type: 'prune', table: 'readings', olderThanDays: 1 } });
    assert.deepEqual(r, { ok: false, skipped: true, code: 'app_disabled' });
    r = await mk()({ appId: 'job-off', action: { type: 'prune', table: 'readings', olderThanDays: 1 } });
    assert.deepEqual(r, { ok: false, skipped: true, code: 'app_disabled' });
    const ls = memoryStore();
    await ls.set('kill:job-a', 1);
    r = await mk({ limiter: createLimiter({ store: ls }) })({ appId: 'job-a', action: conn() });
    assert.deepEqual(r, { ok: false, skipped: true, code: 'app_disabled' });
    r = await mk({ limiter: createLimiter({ store: memoryStore(), perAppPerMin: 0 }) })({ appId: 'job-a', action: conn() });
    assert.deepEqual(r, { ok: false, skipped: true, code: 'rate_limited_app' });
    assert.equal(fetchLog.length, 0);
});

t('the job timeout is applied to the upstream call', async () => {
    const hang = async (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
    const r = await mk({ fetchImpl: hang, timeoutMs: 40 })({ appId: 'job-a', action: conn() });
    assert.deepEqual(r, { ok: false, code: 'upstream_timeout' });
});

t('an abort while the upstream call is in flight stops the run before any write', async () => {
    const ctrl = new AbortController(); let wrote = false;
    const f = async () => { ctrl.abort(); return new Response('{"x":1}', { status: 200 }); };
    const r = await mk({ fetchImpl: f, runQuery: async () => { wrote = true; return { ok: true, rows: [] }; } })({ appId: 'job-a', action: conn({ save: { table: 'readings', map: { temp: '/x' } } }), signal: ctrl.signal });
    assert.deepEqual(r, { ok: false, code: 'timeout' }); assert.equal(wrote, false);
});

t('database error codes are sanitized into db_ codes', async () => {
    respond = () => ({ status: 200, body: { x: 1 } });
    const r = await mk({ runQuery: async () => ({ ok: false, code: 'Bad Code!!' }) })({ appId: 'job-a', action: conn({ save: { table: 'readings', map: { temp: '/x' } } }) });
    assert.match(r.code, /^db_[a-z0-9_]+$/);
});

t('a database error becomes a db_ code; an aborted run does not write', async () => {
    respond = () => ({ status: 200, body: { x: 1 } });
    let r = await mk({ runQuery: async () => ({ ok: false, status: 504, code: 'query_timeout' }) })({ appId: 'job-a', action: conn({ save: { table: 'readings', map: { temp: '/x' } } }) });
    assert.deepEqual(r, { ok: false, code: 'db_query_timeout' });
    const ctrl = new AbortController(); ctrl.abort();
    let wrote = false;
    r = await mk({ runQuery: async () => { wrote = true; return { ok: true, rows: [] }; } })({ appId: 'job-a', action: conn({ save: { table: 'readings', map: { temp: '/x' } } }), signal: ctrl.signal });
    assert.deepEqual(r, { ok: false, code: 'timeout' }); assert.equal(wrote, false);
    r = await mk({ runQuery: async () => { throw new Error('boom password=x'); } })({ appId: 'job-a', action: conn({ save: { table: 'readings', map: { temp: '/x' } } }) });
    assert.deepEqual(r, { ok: false, code: 'internal_error' });
    assert.deepEqual(await mk()({ appId: 'job-a', action: { type: 'notify' } }), { ok: false, code: 'bad_action' });
});

// ---------- prune ----------
t('prune deletes rows older than the cutoff using created_at, in this app only', async () => {
    for (const a of ['job-a', 'job-b']) {
        const tb = await tbl(a, 'readings');
        await owner(`insert into ${tb} (note, created_at) values ('ancient', $1), ('old', $2), ('edge-in', $3), ('fresh', $4), ('exact', $5)`, [new Date(NOW - 400 * 86_400_000), new Date(NOW - 31 * 86_400_000), new Date(NOW - 29 * 86_400_000), new Date(NOW - 1000), new Date(NOW - 30 * 86_400_000)]);
    }
    const r = await mk()({ appId: 'job-a', action: { type: 'prune', table: 'readings', olderThanDays: 30 } });
    assert.deepEqual(r, { ok: true, rows: 2 });
    assert.deepEqual((await owner(`select note from ${await tbl('job-a', 'readings')} order by note`)).map((x) => x.note), ['edge-in', 'exact', 'fresh']);
    assert.equal((await owner(`select count(*)::int n from ${await tbl('job-b', 'readings')}`))[0].n, 5, 'job-b untouched');
    const again = await mk()({ appId: 'job-a', action: { type: 'prune', table: 'readings', olderThanDays: 30 } });
    assert.deepEqual(again, { ok: true, rows: 0 });
    const later = await mk({ now: () => NOW + 60 * 86_400_000 })({ appId: 'job-a', action: { type: 'prune', table: 'readings', olderThanDays: 30 } });
    assert.deepEqual(later, { ok: true, rows: 3 }, 'time travel moves the cutoff');
});

t('prune works in bounded batches: a big backlog takes several runs', async () => {
    const tb = await tbl('job-a', 'readings');
    assert.equal(PRUNE_BATCH * PRUNE_MAX_BATCHES, 5000);
    const total = 5300;
    await owner(`insert into ${tb} (note, created_at) select 'bulk', $1::timestamptz - (g || ' seconds')::interval from generate_series(1, ${total}) g`, [new Date(NOW - 100 * 86_400_000)]);
    const run = () => mk()({ appId: 'job-a', action: { type: 'prune', table: 'readings', olderThanDays: 30 } });
    assert.deepEqual(await run(), { ok: true, rows: 5000 });
    assert.equal((await owner(`select count(*)::int n from ${tb}`))[0].n, 300);
    assert.deepEqual(await run(), { ok: true, rows: 300 });
    assert.equal((await owner(`select count(*)::int n from ${tb}`))[0].n, 0);
});

t('prune refuses tables the schema does not have, and surfaces a database error as a code', async () => {
    assert.deepEqual(await mk()({ appId: 'job-a', action: { type: 'prune', table: 'nope', olderThanDays: 5 } }), { ok: false, code: 'schema_mismatch' });
    assert.deepEqual(await mk({ runQuery: async () => ({ ok: false, code: 'busy' }) })({ appId: 'job-a', action: { type: 'prune', table: 'readings', olderThanDays: 5 } }), { ok: false, code: 'db_busy' });
    const ctrl = new AbortController(); ctrl.abort();
    assert.deepEqual(await mk()({ appId: 'job-a', action: { type: 'prune', table: 'readings', olderThanDays: 5 }, signal: ctrl.signal }), { ok: false, code: 'timeout' });
});
