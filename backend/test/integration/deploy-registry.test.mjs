import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
import { ProxyAdminError } from '../../services/proxyAdmin.js';
const { supabase } = await import('../../config/database.js');

let undeployRows = [{ subdomain: 'my-app', user_id: 'owner-1' }];
stubSupabase(supabase, (q) => {
    if (q.table === 'deployments' && q.op === 'select' && q.single) return { data: null, error: { code: 'PGRST116' } };
    if (q.table === 'deployments' && q.op === 'select') return { data: undeployRows.filter((r) => eqOf(q, 'project_id') === 'proj-1' && eqOf(q, 'user_id') === r.user_id), error: null };
    if (q.table === 'projects' && q.op === 'select' && q.single) return eqOf(q, 'id') === 'proj-1' ? { data: { bundle: 'QUJD', creator_id: 'owner-1', github_repo: null, preview_url: null }, error: null } : { data: null, error: { code: 'PGRST116' } };
    return { data: null, error: null };
});
const { default: router } = await import('../../routes/deploy.routes.js');

const realFetch = globalThis.fetch; let deployStatus = 200;
const calls = []; let behavior = {};
const fakeProxy = (configured = true) => ({ configured, ensureApp: async (a) => { calls.push(['ensure', a]); if (behavior.ensure) throw behavior.ensure; }, setEnabled: async (a, e) => { calls.push(['enabled', a, e]); if (behavior.enabled) throw behavior.enabled; } });
let srv, srvNoProxy;
before(async () => {
    globalThis.fetch = (url, opts = {}) => { const u = new URL(String(url)); if (u.hostname === '127.0.0.1') return realFetch(url, opts); return Promise.resolve(new Response(deployStatus === 200 ? '{}' : '{"error":"boom"}', { status: deployStatus, headers: { 'content-type': 'application/json' } })); };
    const mk = (proxy) => { const app = express(); app.use(express.json()); if (proxy) app.locals.proxyAdmin = proxy; app.use('/api/deploy', router); return listen(app); };
    srv = await mk(fakeProxy()); srvNoProxy = await mk(null);
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); await srvNoProxy.close(); });
const reset = () => { calls.length = 0; behavior = {}; deployStatus = 200; undeployRows = [{ subdomain: 'my-app' }]; };
const post = (s, body, pid = 'proj-1') => realFetch(`${s.base}/api/deploy/${pid}/deploy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = (s, body, pid = 'proj-1') => realFetch(`${s.base}/api/deploy/${pid}/deploy`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const quiet = async (fn) => { const w = console.warn, l = console.log, e = console.error; console.warn = console.log = console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.log = l; console.error = e; } };

test('a successful deploy registers and enables the app in the proxy, then answers as before', async () => {
    reset();
    const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }));
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { success: true, url: 'https://my-app.vibebuild.cc' });
    assert.deepEqual(calls, [['ensure', 'my-app'], ['enabled', 'my-app', true]]);
});

test('a proxy failure does not fail the deploy', async () => {
    reset(); behavior.ensure = new ProxyAdminError(0, 'unreachable');
    const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }));
    assert.equal(r.status, 200); assert.equal((await r.json()).success, true);
});

test('without a configured proxy the deploy works and nothing is called', async () => {
    reset();
    assert.equal((await quiet(() => post(srvNoProxy, { userId: 'owner-1', subdomain: 'my-app' }))).status, 200);
    assert.deepEqual(calls, []);
});

test('a failed deploy, a wrong owner and a bad subdomain never touch the proxy', async () => {
    reset(); deployStatus = 500;
    assert.equal((await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }))).status, 500);
    reset();
    assert.equal((await quiet(() => post(srv, { userId: 'someone-else', subdomain: 'my-app' }))).status, 403);
    assert.equal((await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'Bad_Name' }))).status, 400);
    assert.deepEqual(calls, []);
});

test('undeploying switches each of the project\'s deployed apps off in the proxy', async () => {
    reset(); undeployRows = [{ subdomain: 'my-app', user_id: 'owner-1' }, { subdomain: 'second-app', user_id: 'owner-1' }];
    const r = await quiet(() => del(srv, { userId: 'owner-1' }));
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { success: true });
    assert.deepEqual(calls, [['enabled', 'my-app', false], ['enabled', 'second-app', false]]);
});

test('a proxy failure does not fail the undeploy, and an unconfigured proxy is skipped', async () => {
    reset(); behavior.enabled = new ProxyAdminError(500, 'internal');
    assert.equal((await quiet(() => del(srv, { userId: 'owner-1' }))).status, 200);
    reset();
    assert.equal((await quiet(() => del(srvNoProxy, { userId: 'owner-1' }))).status, 200); assert.deepEqual(calls, []);
});

test('undeploying as a different user disables nothing', async () => {
    reset();
    assert.equal((await quiet(() => del(srv, { userId: 'someone-else' }))).status, 200);
    assert.deepEqual(calls, []);
});
