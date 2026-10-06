import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
import { ProxyAdminError } from '../../services/proxyAdmin.js';
import { zip, file } from '../helpers/zip.mjs';
const { supabase } = await import('../../config/database.js');
const { createSchemaPlanRouter } = await import('../../routes/schemaPlan.routes.js');

const SPEC = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true } } } } };
const WITH = zip([file('index.html', '<html></html>'), file('vibe.schema.json', SPEC)]);
const WITHOUT = zip([file('index.html', '<html></html>')]);
const REPO_BUNDLE = zip([file('index.html', '<html></html>'), file('vibe.schema.json', { ...SPEC, tables: { repo_table: SPEC.tables.todos } })]);
const P = (c) => `${c}`.repeat(8) + '-2222-3333-4444-555555555555';
const projects = { [P('a')]: { bundle: WITH, creator_id: 'owner-1', github_repo: null }, [P('b')]: { bundle: WITHOUT, creator_id: 'owner-1', github_repo: null }, [P('c')]: { bundle: WITH, creator_id: 'owner-1', github_repo: 'owner/repo' } };
stubSupabase(supabase, (q) => {
    if (q.table === 'projects') { const r = projects[eqOf(q, 'id')]; return r ? { data: r, error: null } : { data: null, error: { code: 'PGRST116' } }; }
    if (q.table === 'deployments') return eqOf(q, 'subdomain') === 'my-app' ? { data: { id: 'd1' }, error: null } : { data: null, error: { code: 'PGRST116' } };
    return { data: null, error: null };
});
const tokens = { 'tok-owner': 'owner-1', 'tok-other': 'other-2' };
const verifyUser = async (req) => tokens[(req.headers.authorization || '').replace('Bearer ', '')] || null;
const calls = []; let behavior = {}; let workerReply = null;
const proxyAdmin = { configured: true,
    planSchema: async (a, spec) => { calls.push(['plan', a, spec]); if (behavior.plan) throw behavior.plan; return behavior.out || { ok: true, statements: 2, destructive: [{ kind: 'drop_table', table: 'old_things' }] }; },
    setSchema: async () => { throw new Error('plan must never apply'); } };
const logs = []; let srv, srvOff;
const fetchImpl = async () => { if (workerReply === 'throw') throw new Error('down'); return new Response(JSON.stringify(workerReply), { status: workerReply ? 200 : 500 }); };
before(async () => {
    const mk = (p) => { const app = express(); app.use('/api/projects/:id/schema', createSchemaPlanRouter({ supabase, verifyUser, proxyAdmin: p, fetchImpl, log: (...a) => logs.push(a.join(' ')) })); return listen(app); };
    srv = await mk(proxyAdmin); srvOff = await mk({ configured: false });
});
after(async () => { await srv.close(); await srvOff.close(); });
const reset = () => { calls.length = 0; behavior = {}; workerReply = null; logs.length = 0; };
const get = (s, id, { token = 'tok-owner', sub = 'my-app' } = {}) => fetch(`${s.base}/api/projects/${id}/schema/plan${sub === null ? '' : `?subdomain=${sub}`}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test('owner gets the plan: counts and destructive names only, from the stored spec and the live app', async () => {
    reset();
    const r = await get(srv, P('a')); assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { hasSchema: true, existing: true, status: 'ok', statements: 2, destructive: [{ kind: 'drop_table', table: 'old_things' }] });
    assert.deepEqual(calls, [['plan', 'my-app', SPEC]]);
    assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('no token, a bogus token, and a non-owner are refused before anything is read or planned', async () => {
    reset();
    assert.equal((await get(srv, P('a'), { token: null })).status, 401);
    assert.equal((await get(srv, P('a'), { token: 'tok-bogus' })).status, 401);
    assert.equal((await get(srv, P('a'), { token: 'tok-other' })).status, 403);
    assert.equal((await get(srv, 'ffffffff-2222-3333-4444-555555555555')).status, 404);
    assert.equal((await get(srv, 'x')).status, 404);
    assert.deepEqual(calls, []);
});

test('a bad or missing subdomain is 400 and an unconfigured proxy is 503', async () => {
    reset();
    for (const sub of [null, 'Bad_Name', 'a']) assert.equal((await get(srv, P('a'), { sub })).status, 400, String(sub));
    assert.equal((await get(srvOff, P('a'))).status, 503);
    assert.deepEqual(calls, []);
});

test('a bundle without a schema has nothing to plan', async () => {
    reset(); assert.deepEqual(await (await get(srv, P('b'))).json(), { hasSchema: false }); assert.deepEqual(calls, []);
});

test('a subdomain that is not a deployment of this project is never planned against (no peeking at other apps)', async () => {
    reset(); assert.deepEqual(await (await get(srv, P('a'), { sub: 'someone-elses-app' })).json(), { hasSchema: true, existing: false, statements: 0, destructive: [] });
    assert.deepEqual(calls, []);
});

test('an app the proxy does not know yet plans as a first deploy; an invalid schema is generic; other failures are 502 with no detail', async () => {
    reset(); behavior.plan = new ProxyAdminError(404, 'unknown_app');
    assert.deepEqual(await (await get(srv, P('a'))).json(), { hasSchema: true, existing: false, statements: 0, destructive: [] });
    reset(); behavior.plan = new ProxyAdminError(400, 'invalid_schema');
    assert.deepEqual(await (await get(srv, P('a'))).json(), { hasSchema: true, existing: true, status: 'invalid' });
    reset(); behavior.plan = new ProxyAdminError(0, 'unreachable');
    const r = await get(srv, P('a')); assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: 'plan_unavailable' });
    assert.deepEqual(logs, ['[schema-plan] failed project=' + P('a') + ' code=unreachable']);
});

test('the proxy answer is sanitised again: junk kinds, odd names and extra fields never reach the browser', async () => {
    reset(); behavior.out = { ok: true, statements: 'many', destructive: [{ kind: 'drop_column', table: 'todos', column: 'n', data: 'ROW' }, { kind: 'x', table: 'y' }] };
    assert.deepEqual(await (await get(srv, P('a'))).json(), { hasSchema: true, existing: true, status: 'ok', statements: 0, destructive: [{ kind: 'drop_column', table: 'todos', column: 'n' }] });
});

test('a project with a repo plans from the latest git bundle, and falls back to the stored one when the worker fails', async () => {
    reset(); workerReply = { bundle: REPO_BUNDLE };
    await get(srv, P('c')); assert.deepEqual(Object.keys(calls[0][2].tables), ['repo_table']);
    reset(); workerReply = 'throw';
    await get(srv, P('c')); assert.deepEqual(Object.keys(calls[0][2].tables), ['todos']);
});
