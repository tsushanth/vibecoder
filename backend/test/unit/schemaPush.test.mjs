import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaFromBundle, MAX_SCHEMA_BYTES } from '../../lib/bundleSchema.js';
import { registerDeployedApp } from '../../services/appRegistry.js';
import { createProxyAdmin, ProxyAdminError } from '../../services/proxyAdmin.js';
import { zip, file } from '../helpers/zip.mjs';

const SPEC = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true } } } } };
const PID = 'abcdef12-3456-7890-abcd-ef1234567890';
const TOKEN = 'admin-token-' + 'x'.repeat(40);
const withSchema = zip([file('index.html', 'x'), file('vibe.schema.json', SPEC)]);
const noSchema = zip([file('index.html', 'x')]);

// ---- bundle reader ----
test('finds a deflated or stored vibe.schema.json at the root', () => {
    assert.deepEqual(schemaFromBundle(withSchema), { status: 'found', spec: SPEC });
    assert.deepEqual(schemaFromBundle(zip([file('vibe.schema.json', SPEC, { deflate: false })])), { status: 'found', spec: SPEC });
});
test('no schema file is none; a nested one is ignored; the first root entry wins', () => {
    assert.deepEqual(schemaFromBundle(noSchema), { status: 'none' });
    assert.deepEqual(schemaFromBundle(zip([file('app/vibe.schema.json', SPEC)])), { status: 'none' });
    const other = { version: 1, tables: {} };
    assert.deepEqual(schemaFromBundle(zip([file('vibe.schema.json', SPEC), file('vibe.schema.json', other)])), { status: 'found', spec: SPEC });
});
test('non-object or unparseable content, garbage and non-string bundles are unreadable and never throw', () => {
    for (const bad of ['{nope', '[]', 'null', '"x"', '']) assert.deepEqual(schemaFromBundle(zip([file('vibe.schema.json', bad)])), { status: 'unreadable' }, bad);
    const good = Buffer.from(withSchema, 'base64');
    for (const b of ['', 'not base64 !!!', good.subarray(0, good.length - 10).toString('base64'), null, undefined, 42]) assert.deepEqual(schemaFromBundle(b), { status: 'unreadable' }, String(b).slice(0, 20));
});
test('the size cap holds for the declared size and the real inflated size, and other big files are not inflated', () => {
    const big = JSON.stringify({ version: 1, pad: 'x'.repeat(MAX_SCHEMA_BYTES + 10) });
    assert.deepEqual(schemaFromBundle(zip([file('vibe.schema.json', big)])), { status: 'unreadable' });
    assert.deepEqual(schemaFromBundle(zip([file('vibe.schema.json', big, { claimSize: 100 })])), { status: 'unreadable' }, 'lying size field');
    assert.deepEqual(schemaFromBundle(zip([file('vibe.schema.json', big, { deflate: false, claimSize: 100 })])), { status: 'unreadable' });
    assert.deepEqual(schemaFromBundle(zip([file('vibe.schema.json', JSON.stringify({ pad: 'x'.repeat(200000) }), { deflate: false })])), { status: 'unreadable' }, 'honest 200 KB file');
    assert.equal(MAX_SCHEMA_BYTES, 65536);
    const many = Array.from({ length: 5001 }, (_, i) => file(`f${i}.txt`, 'a'));
    assert.deepEqual(schemaFromBundle(zip([...many, file('vibe.schema.json', SPEC)])), { status: 'unreadable' }, 'too many entries');
    assert.equal(schemaFromBundle(zip([...many.slice(0, 100), file('vibe.schema.json', SPEC)])).status, 'found');
    const ok = JSON.stringify({ version: 1, pad: 'x'.repeat(30000) });
    assert.equal(schemaFromBundle(zip([file('vibe.schema.json', ok)])).status, 'found', 'a schema bigger than a manifest is allowed');
    assert.equal(schemaFromBundle(zip([file('big.bin', 'a'.repeat(5 * 1024 * 1024)), file('vibe.schema.json', SPEC)])).status, 'found');
});

// ---- proxy admin client ----
const rig = (reply) => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined }); return reply; };
    return { calls, admin: createProxyAdmin({ baseUrl: 'https://proxy.test', token: TOKEN, fetchImpl, timeoutMs: 200 }) };
};
const res = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('setSchema POSTs the spec with allowDestructive true only when literally true; getSchema GETs', async () => {
    const a = rig(res(200, { version: 2, applied: 1 }));
    assert.deepEqual(await a.admin.setSchema('my-app', SPEC), { version: 2, applied: 1 });
    assert.equal(a.calls[0].url, 'https://proxy.test/admin/apps/my-app/schema'); assert.equal(a.calls[0].init.method, 'POST');
    assert.deepEqual(a.calls[0].body, { spec: SPEC, allowDestructive: false });
    assert.equal(new Headers(a.calls[0].init.headers).get('authorization'), `Bearer ${TOKEN}`);
    await a.admin.setSchema('my-app', SPEC, { allowDestructive: true }); assert.equal(a.calls[1].body.allowDestructive, true);
    await a.admin.setSchema('my-app', SPEC, { allowDestructive: 'yes' }); assert.equal(a.calls[2].body.allowDestructive, false);
    const g = rig(res(200, { version: 1, spec: SPEC }));
    assert.deepEqual(await g.admin.getSchema('a/../b'), { version: 1, spec: SPEC });
    assert.equal(g.calls[0].init.method, 'GET'); assert.ok(g.calls[0].url.endsWith('/a%2F..%2Fb/schema'));
});
test('schema error codes survive, including the long destructive one', async () => {
    for (const [status, code] of [[400, 'invalid_schema'], [409, 'destructive_change_needs_confirmation'], [422, 'migration_failed'], [404, 'unknown_app']]) {
        await assert.rejects(() => rig(res(status, { error: code })).admin.setSchema('a-app', SPEC), (e) => e.status === status && e.code === code, code);
    }
});

// ---- registerDeployedApp ----
const fake = ({ setSchema } = {}) => {
    const calls = [];
    const rec = (name) => async (...a) => { calls.push([name, ...a]); return name === 'copySecrets' ? { copied: 0 } : null; };
    return { configured: true, calls, ensureApp: rec('ensure'), setEnabled: rec('enabled'), setManifest: rec('manifest'), copySecrets: rec('copy'),
        setSchema: async (...a) => { calls.push(['schema', ...a]); if (setSchema instanceof Error) throw setSchema; return setSchema || { version: 1, applied: 2 }; } };
};
const logs = () => { const l = []; return { l, log: (...a) => l.push(a.join(' ')) }; };
const reg = (p, src, log = logs().log) => registerDeployedApp(p, 'my-app', log, src);

test('a schema in the bundle is pushed to the subdomain app only (never the project-id app), non-destructively, before the app is enabled', async () => {
    const p = fake(); const result = {};
    assert.equal(await reg(p, { projectId: PID, bundle: withSchema, result }), true);
    assert.deepEqual(p.calls, [['ensure', 'my-app'], ['manifest', 'my-app', null], ['manifest', PID, null], ['schema', 'my-app', SPEC, { allowDestructive: false }], ['enabled', 'my-app', true]]);
    assert.equal(result.schemaStatus, 'applied');
});
test('the schema is pushed even without a project id, and allowDestructive is forwarded only when literally true', async () => {
    const p = fake(); await reg(p, { bundle: withSchema, allowDestructive: true });
    assert.deepEqual(p.calls.find((c) => c[0] === 'schema'), ['schema', 'my-app', SPEC, { allowDestructive: true }]);
    for (const v of ['true', 1, undefined]) { const q = fake(); await reg(q, { bundle: withSchema, allowDestructive: v }); assert.deepEqual(q.calls.find((c) => c[0] === 'schema')[3], { allowDestructive: false }, String(v)); }
});
test('statuses: applied, unchanged, invalid, needs_confirmation, failed', async () => {
    const cases = [
        [{ version: 3, applied: 0 }, 'unchanged'], [{ version: 1, applied: 1 }, 'applied'],
        [new ProxyAdminError(400, 'invalid_schema'), 'invalid'], [new ProxyAdminError(409, 'destructive_change_needs_confirmation'), 'needs_confirmation'],
        [new ProxyAdminError(422, 'migration_failed'), 'failed'], [new ProxyAdminError(0, 'unreachable'), 'failed'], [new ProxyAdminError(404, 'unknown_app'), 'failed'], [new Error('boom'), 'failed'],
    ];
    for (const [reply, want] of cases) { const result = {}; assert.equal(await reg(fake({ setSchema: reply }), { bundle: withSchema, result }), true); assert.equal(result.schemaStatus, want, String(reply?.code || JSON.stringify(reply))); }
});
test('a failed push never fails the deploy: the app is still enabled, and only the code is logged', async () => {
    const p = fake({ setSchema: new ProxyAdminError(422, 'migration_failed') }); const { l, log } = logs();
    assert.equal(await reg(p, { bundle: withSchema }, log), true);
    assert.equal(p.calls.at(-1)[0], 'enabled');
    assert.ok(l.some((x) => /migration_failed/.test(x) && /my-app/.test(x)), JSON.stringify(l));
    assert.equal(l.join('\n').includes('todos'), false, 'no spec content in logs');
});
test('no schema or an unreadable one: the database is left alone (no call) and no status is reported', async () => {
    for (const bundle of [noSchema, zip([file('vibe.schema.json', '{nope')]), 'QUJD', '', undefined]) {
        const p = fake(); const result = {};
        assert.equal(await reg(p, { projectId: PID, bundle, result }), true);
        assert.equal(p.calls.some((c) => c[0] === 'schema'), false, String(bundle).slice(0, 12));
        assert.deepEqual(result, {});
    }
});
test('callers that pass no result object still work', async () => {
    assert.equal(await reg(fake(), { bundle: withSchema }), true);
});
test('a schema is not pushed when the app could not even be registered', async () => {
    const p = fake(); p.ensureApp = async () => { throw new ProxyAdminError(0, 'unreachable'); };
    assert.equal(await reg(p, { bundle: withSchema }), false);
    assert.equal(p.calls.length, 0);
});

test('needs_confirmation copies the destructive list (names only) into the result; other statuses do not', async () => {
    const e = new ProxyAdminError(409, 'destructive_change_needs_confirmation');
    e.destructive = [{ kind: 'drop_column', table: 'todos', column: 'n', value: 'secret row data' }, { kind: 'evil', table: 'x' }, { kind: 'drop_table', table: 'Bad Name' }];
    const result = {}; await reg(fake({ setSchema: e }), { bundle: withSchema, result });
    assert.equal(result.schemaStatus, 'needs_confirmation'); assert.deepEqual(result.destructive, [{ kind: 'drop_column', table: 'todos', column: 'n' }]);
    const r2 = {}; await reg(fake({ setSchema: new ProxyAdminError(422, 'migration_failed') }), { bundle: withSchema, result: r2 });
    assert.equal('destructive' in r2, false);
});

test('the destructive list is capped so a hostile proxy answer cannot bloat the deploy response', async () => {
    const e = new ProxyAdminError(409, 'destructive_change_needs_confirmation');
    e.destructive = Array.from({ length: 500 }, (_, i) => ({ kind: 'drop_table', table: `t${i}` }));
    const result = {}; await reg(fake({ setSchema: e }), { bundle: withSchema, result });
    assert.equal(result.destructive.length, 100);
});
