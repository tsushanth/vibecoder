import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmin, SCHEMA_BODY_LIMIT, ADMIN_BODY_LIMIT } from '../admin.js';

const TOKEN = 'admin-token-' + 'x'.repeat(40);
const GOOD = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true } } } } };
const memLimiter = () => { const m = new Map(); return { get: async (k) => m.get(k) || 0, incr: async (k) => m.set(k, (m.get(k) || 0) + 1) }; };

function rig({ apps = ['app1'], apply, current, executor = 'default' } = {}) {
    const calls = [];
    const dataExecutor = executor === 'none' ? undefined : {
        applySchema: async (a) => { calls.push(['apply', a]); return apply ? apply(a) : { ok: true, applied: 2, version: 1 }; },
        peekSpec: async (id) => { calls.push(['peek', id]); return current ? current(id) : { spec: GOOD, version: 3 }; },
    };
    const appStore = { get: async (id) => (apps.includes(id) ? { enabled: true, domains: [], manifest: null } : null) };
    const handle = createAdmin({ token: TOKEN, appStore, secretStore: {}, limiterStore: memLimiter(), baseDomain: 'vibebuild.cc', dataExecutor });
    const bodies = [];
    const req = (method, pathname, body, { token = TOKEN, ip = '1.1.1.1', bodyResult } = {}) => handle({
        method, pathname, ip, headers: token ? { authorization: `Bearer ${token}` } : {},
        readBody: async (limit) => { bodies.push(limit); return bodyResult || { value: body }; },
    });
    return { calls, req, bodies };
}

test('POST applies a valid spec as the app and answers 200 with version and applied only', async () => {
    const r = rig(); const out = await r.req('POST', '/admin/apps/app1/schema', { spec: GOOD });
    assert.deepEqual(out, { status: 200, body: { version: 1, applied: 2 } });
    assert.equal(r.calls.length, 1);
    const [, a] = r.calls[0];
    assert.equal(a.appId, 'app1'); assert.equal(a.allowDestructive, false);
    assert.equal(a.spec.tables.todos.columns.title.type, 'text');
});

test('the executor receives the normalized spec from validateSpec, not the raw input', async () => {
    const r = rig(); await r.req('POST', '/admin/apps/app1/schema', { spec: { version: 1, tables: { todos: { columns: { t: { type: 'text' } } } } } });
    assert.equal(r.calls[0][1].spec.tables.todos.access, 'owner', 'default access is filled in');
});

test('allowDestructive is passed through only when it is literally true', async () => {
    for (const [v, want] of [[true, true], [false, false], [undefined, false]]) {
        const r = rig(); await r.req('POST', '/admin/apps/app1/schema', { spec: GOOD, allowDestructive: v });
        assert.equal(r.calls[0][1].allowDestructive, want, String(v));
    }
    for (const bad of ['true', 1, null, {}]) {
        const r = rig(); const out = await r.req('POST', '/admin/apps/app1/schema', { spec: GOOD, allowDestructive: bad });
        assert.equal(out.status, 400, String(bad)); assert.equal(out.body.error, 'invalid_allow_destructive'); assert.equal(r.calls.length, 0);
    }
});

test('an invalid spec is 400 invalid_schema with code-only errors and never reaches the executor', async () => {
    const r = rig();
    const out = await r.req('POST', '/admin/apps/app1/schema', { spec: { version: 1, tables: { 'Bad Name': { columns: {} } } } });
    assert.equal(out.status, 400); assert.equal(out.body.error, 'invalid_schema');
    assert.ok(out.body.errors.length > 0 && out.body.errors.every((e) => typeof e.code === 'string'));
    assert.equal(r.calls.length, 0);
    for (const spec of [undefined, null, 'x', [], 5]) {
        const o = await r.req('POST', '/admin/apps/app1/schema', { spec });
        assert.equal(o.status, 400, String(spec)); assert.equal(o.body.error, 'invalid_schema');
    }
    assert.equal(r.calls.length, 0);
});

test('validation errors are capped so a hostile spec cannot make a huge response', async () => {
    const tables = {}; for (let i = 0; i < 200; i++) tables[`T${i}`] = {};
    const out = await rig().req('POST', '/admin/apps/app1/schema', { spec: { version: 1, tables } });
    assert.equal(out.status, 400); assert.ok(out.body.errors.length > 0 && out.body.errors.length <= 20, String(out.body.errors.length));
});

test('a destructive change without confirmation is 409 listing what would be lost', async () => {
    const destructive = [{ kind: 'drop_table', table: 'todos' }];
    const r = rig({ apply: () => ({ ok: false, errors: [{ code: 'destructive_change_needs_confirmation' }], destructive }) });
    const out = await r.req('POST', '/admin/apps/app1/schema', { spec: GOOD });
    assert.deepEqual(out, { status: 409, body: { error: 'destructive_change_needs_confirmation', destructive } });
});

test('planner errors such as required_needs_default are 400 invalid_schema with the codes', async () => {
    const errors = [{ code: 'required_needs_default', table: 'todos', column: 'x' }];
    const out = await rig({ apply: () => ({ ok: false, errors }) }).req('POST', '/admin/apps/app1/schema', { spec: GOOD });
    assert.deepEqual(out, { status: 400, body: { error: 'invalid_schema', errors } });
});

test('planner errors are capped too', async () => {
    const errors = Array.from({ length: 60 }, (_, i) => ({ code: 'required_needs_default', table: 't', column: `c${i}` }));
    const out = await rig({ apply: () => ({ ok: false, errors }) }).req('POST', '/admin/apps/app1/schema', { spec: GOOD });
    assert.equal(out.status, 400); assert.equal(out.body.errors.length, 20);
});

test('a failed migration is 422 migration_failed with no database message', async () => {
    const out = await rig({ apply: () => ({ ok: false, errors: [{ code: 'migration_failed' }] }) }).req('POST', '/admin/apps/app1/schema', { spec: GOOD });
    assert.deepEqual(out, { status: 422, body: { error: 'migration_failed' } });
});

test('an unknown app is 404 unknown_app and the executor is never asked to provision it', async () => {
    const r = rig(); const out = await r.req('POST', '/admin/apps/ghost/schema', { spec: GOOD });
    assert.deepEqual(out, { status: 404, body: { error: 'unknown_app' } });
    assert.deepEqual((await r.req('GET', '/admin/apps/ghost/schema')), { status: 404, body: { error: 'unknown_app' } });
    assert.equal(r.calls.length, 0);
});

test('GET returns the current spec and version', async () => {
    const r = rig(); const out = await r.req('GET', '/admin/apps/app1/schema');
    assert.deepEqual(out, { status: 200, body: { version: 3, spec: GOOD } });
    assert.deepEqual(r.calls, [['peek', 'app1']]);
    const none = await rig({ current: () => ({ spec: null, version: 0 }) }).req('GET', '/admin/apps/app1/schema');
    assert.deepEqual(none, { status: 200, body: { version: 0, spec: null } });
});

test('GET exposes only spec and version even if the executor returns more (no role or schema names)', async () => {
    const out = await rig({ current: () => ({ spec: GOOD, version: 1, role_name: 'appr_x', schema_name: 'apps_x' }) }).req('GET', '/admin/apps/app1/schema');
    assert.deepEqual(Object.keys(out.body).sort(), ['spec', 'version']);
});

test('the route needs the bearer token and counts failures like the other admin routes', async () => {
    const r = rig();
    for (const token of [null, 'wrong']) assert.equal((await r.req('POST', '/admin/apps/app1/schema', { spec: GOOD }, { token })).status, 401);
    assert.equal((await r.req('GET', '/admin/apps/app1/schema', undefined, { token: null })).status, 401);
    assert.equal(r.calls.length, 0);
    for (let i = 0; i < 12; i++) await r.req('GET', '/admin/apps/app1/schema', undefined, { token: 'wrong', ip: '9.9.9.9' });
    assert.equal((await r.req('GET', '/admin/apps/app1/schema', undefined, { ip: '9.9.9.9' })).status, 429);
});

test('methods and sub-paths are strict', async () => {
    const r = rig();
    for (const m of ['PUT', 'DELETE', 'PATCH']) assert.equal((await r.req(m, '/admin/apps/app1/schema', { spec: GOOD })).status, 405, m);
    assert.equal((await r.req('POST', '/admin/apps/app1/schema/extra', { spec: GOOD })).status, 404);
    assert.equal(r.calls.length, 0);
});

test('body problems map to 413 and 400 and the schema route allows a larger body than the other admin routes', async () => {
    const r = rig();
    assert.equal((await r.req('POST', '/admin/apps/app1/schema', {}, { bodyResult: { error: 413 } })).body.error, 'request_too_large');
    assert.equal((await r.req('POST', '/admin/apps/app1/schema', {}, { bodyResult: { error: 400 } })).body.error, 'bad_json');
    assert.deepEqual(r.bodies, [SCHEMA_BODY_LIMIT, SCHEMA_BODY_LIMIT]);
    assert.ok(SCHEMA_BODY_LIMIT > ADMIN_BODY_LIMIT && SCHEMA_BODY_LIMIT <= 131072);
});

test('without a data executor both methods answer 503 schema_unavailable', async () => {
    const r = rig({ executor: 'none' });
    assert.deepEqual(await r.req('POST', '/admin/apps/app1/schema', { spec: GOOD }), { status: 503, body: { error: 'schema_unavailable' } });
    assert.deepEqual(await r.req('GET', '/admin/apps/app1/schema'), { status: 503, body: { error: 'schema_unavailable' } });
});
