import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
import { ProxyAdminError } from '../../services/proxyAdmin.js';
import { zip, file } from '../helpers/zip.mjs';

const MANIFEST = { connectors: { stocks: { host: 'api.example.com', paths: ['/v1/*'], methods: ['GET'], secret: { name: 'STOCKS_API_KEY', in: 'query', field: 'apikey' } } } };
const MANIFEST_BUNDLE = zip([file('index.html', '<html></html>'), file('vibe.manifest.json', MANIFEST)]);
const SPEC = { version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true } } } } };
const SCHEMA_BUNDLE = zip([file('index.html', '<html></html>'), file('vibe.schema.json', SPEC)]);
const JOBS = { version: 1, jobs: [{ id: 'cleanup', schedule: { dailyAt: '03:00', tz: 'UTC' }, action: { type: 'prune', table: 'todos', olderThanDays: 30 } }] };
const JOBS_BUNDLE = zip([file('index.html', '<html></html>'), file('vibe.schema.json', SPEC), file('vibe.jobs.json', JOBS)]);
const { supabase } = await import('../../config/database.js');

let undeployRows = [{ subdomain: 'my-app', user_id: 'owner-1' }];
let subscriptionRow = null; // what user_subscriptions returns for the deploying user (null = no row, which the service reads as an error)
stubSupabase(supabase, (q) => {
    if (q.table === 'deployments' && q.op === 'select' && q.single) return { data: null, error: { code: 'PGRST116' } };
    if (q.table === 'deployments' && q.op === 'select') return { data: undeployRows.filter((r) => eqOf(q, 'project_id') === 'proj-1' && eqOf(q, 'user_id') === r.user_id), error: null };
    if (q.table === 'projects' && q.op === 'select' && q.single) return ['proj-1', 'proj-manifest', 'proj-schema', 'proj-jobs'].includes(eqOf(q, 'id')) ? { data: { bundle: eqOf(q, 'id') === 'proj-manifest' ? MANIFEST_BUNDLE : eqOf(q, 'id') === 'proj-schema' ? SCHEMA_BUNDLE : eqOf(q, 'id') === 'proj-jobs' ? JOBS_BUNDLE : 'QUJD', creator_id: 'owner-1', github_repo: null, preview_url: null }, error: null } : { data: null, error: { code: 'PGRST116' } };
    if (q.table === 'user_subscriptions' && q.op === 'select') return subscriptionRow ? { data: subscriptionRow, error: null } : { data: null, error: { code: 'PGRST116' } };
    return { data: null, error: null };
});
const { default: router } = await import('../../routes/deploy.routes.js');

const realFetch = globalThis.fetch; let deployStatus = 200;
const calls = []; const limitCalls = []; let behavior = {};
const fakeProxy = (configured = true) => ({ configured, getLimits: async (a) => { limitCalls.push(['limits-get', a]); return { defaults: { rowCap: 20000, dailyCalls: 5000 }, overrides: behavior.overrides || {} }; }, setLimits: async (a, o) => { limitCalls.push(['limits-set', a, o]); if (behavior.limitsErr) throw behavior.limitsErr; }, ensureApp: async (a) => { calls.push(['ensure', a]); if (behavior.ensure) throw behavior.ensure; }, setEnabled: async (a, e) => { calls.push(['enabled', a, e]); if (behavior.enabled) throw behavior.enabled; }, setManifest: async (a, m) => { calls.push(['manifest', a, m]); }, copySecrets: async (to, from, o) => { calls.push(['copy', to, from, o]); return { copied: 0 }; }, setSchema: async (a, spec, o) => { calls.push(['schema', a, spec, o]); if (behavior.schema) throw behavior.schema; return behavior.schemaOut || { version: 1, applied: 2 }; }, setJobs: async (a, spec) => { calls.push(['jobs', a, spec]); if (behavior.jobs) throw behavior.jobs; return { jobs: 1, warnings: [] }; } });
let srv, srvNoProxy;
before(async () => {
    globalThis.fetch = (url, opts = {}) => { const u = new URL(String(url)); if (u.hostname === '127.0.0.1') return realFetch(url, opts); return Promise.resolve(new Response(deployStatus === 200 ? '{}' : '{"error":"boom"}', { status: deployStatus, headers: { 'content-type': 'application/json' } })); };
    const mk = (proxy) => { const app = express(); app.use(express.json()); if (proxy) app.locals.proxyAdmin = proxy; app.locals.verifyUser = async (req) => ({ 'Bearer tok-owner': 'owner-1', 'Bearer tok-other': 'other-2' })[req.headers.authorization] || null; app.use('/api/deploy', router); return listen(app); };
    srv = await mk(fakeProxy()); srvNoProxy = await mk(null);
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); await srvNoProxy.close(); });
const reset = () => { calls.length = 0; limitCalls.length = 0; behavior = {}; subscriptionRow = null; deployStatus = 200; undeployRows = [{ subdomain: 'my-app' }]; };
const post = (s, body, pid = 'proj-1', token) => realFetch(`${s.base}/api/deploy/${pid}/deploy`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
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

test('a reserved name is refused with 400 before anything is deployed or registered', async () => {
    reset();
    for (const name of ['vibe-proxy', 'www', 'preview-abc123']) {
        const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: name }));
        assert.equal(r.status, 400, name); assert.match((await r.json()).error, /reserved/);
    }
    assert.deepEqual(calls, []);
});

test('deploying a project whose bundle carries a manifest registers the manifest and copies the project keys before enabling', async () => {
    reset();
    const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-manifest'));
    assert.equal(r.status, 200);
    assert.deepEqual(calls, [['ensure', 'my-app'], ['ensure', 'proj-manifest'], ['enabled', 'proj-manifest', false], ['manifest', 'proj-manifest', MANIFEST], ['manifest', 'my-app', MANIFEST], ['copy', 'my-app', 'proj-manifest', { replace: true }], ['enabled', 'my-app', true]]);
});

test('a project id is not accepted as a subdomain', async () => {
    reset();
    const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: '11111111-2222-3333-4444-555555555555' }));
    assert.equal(r.status, 400); assert.deepEqual(calls, []);
});

test('deploying a bundle with a schema pushes it to the deployed app and reports schemaStatus', async () => {
    reset();
    const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-schema'));
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { success: true, url: 'https://my-app.vibebuild.cc', schemaStatus: 'applied' });
    assert.deepEqual(calls.find((c) => c[0] === 'schema'), ['schema', 'my-app', SPEC, { allowDestructive: false }]);
});

test('a deploy only allows destructive schema changes when the request says allowDestructiveSchema: true and the verified owner sent it', async () => {
    reset();
    const ok = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app', allowDestructiveSchema: true }, 'proj-schema', 'tok-owner'));
    assert.equal(ok.status, 200);
    assert.equal(calls.find((c) => c[0] === 'schema')[3].allowDestructive, true);
    reset();
    await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app', allowDestructiveSchema: 'true' }, 'proj-schema', 'tok-owner'));
    assert.equal(calls.find((c) => c[0] === 'schema')[3].allowDestructive, false);
});

test('confirming a destructive change without a verified owner token is 403 and nothing is deployed or pushed', async () => {
    for (const token of [undefined, 'tok-other', 'tok-bogus']) {
        reset();
        const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app', allowDestructiveSchema: true }, 'proj-schema', token));
        assert.equal(r.status, 403, String(token)); assert.equal((await r.json()).error, 'destructive_confirmation_requires_owner');
        assert.deepEqual(calls, [], String(token));
    }
});

test('a needs_confirmation answer carries the destructive list (names only) and a normal deploy needs no token', async () => {
    reset();
    const e = new ProxyAdminError(409, 'destructive_change_needs_confirmation'); e.destructive = [{ kind: 'drop_table', table: 'todos' }, { kind: 'drop_column', table: 'notes', column: 'body' }];
    behavior.schema = e;
    const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-schema'));
    assert.equal(r.status, 200); const j = await r.json();
    assert.equal(j.schemaStatus, 'needs_confirmation'); assert.deepEqual(j.destructive, e.destructive);
    reset(); behavior.schemaOut = { version: 1, applied: 1 };
    const ok = await (await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-schema'))).json();
    assert.equal('destructive' in ok, false);
});

test('a schema that needs confirmation or fails does not fail the deploy but is surfaced', async () => {
    reset(); behavior.schema = new ProxyAdminError(409, 'destructive_change_needs_confirmation');
    let r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-schema'));
    assert.equal(r.status, 200); let j = await r.json(); assert.equal(j.success, true); assert.equal(j.schemaStatus, 'needs_confirmation');
    reset(); behavior.schema = new ProxyAdminError(422, 'migration_failed');
    r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-schema'));
    assert.equal(r.status, 200); assert.equal((await r.json()).schemaStatus, 'failed');
    assert.deepEqual(calls.at(-1), ['enabled', 'my-app', true]);
});

test('a bundle without a schema answers exactly as before (no schemaStatus key)', async () => {
    reset();
    const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }));
    assert.deepEqual(await r.json(), { success: true, url: 'https://my-app.vibebuild.cc' });
});

test('a bundle with vibe.jobs.json pushes the jobs after the schema and reports jobsStatus', async () => {
    reset();
    const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-jobs'));
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { success: true, url: 'https://my-app.vibebuild.cc', schemaStatus: 'applied', jobsStatus: 'applied' });
    assert.deepEqual(calls.filter((c) => ['schema', 'jobs', 'enabled'].includes(c[0])).map((c) => c[0]), ['schema', 'jobs', 'enabled']);
    assert.deepEqual(calls.find((c) => c[0] === 'jobs'), ['jobs', 'my-app', JOBS]);
});

test('rejected or failed jobs do not fail the deploy but are surfaced; a bundle without jobs has no jobsStatus key', async () => {
    reset(); behavior.jobs = new ProxyAdminError(400, 'invalid_jobs');
    let r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-jobs'));
    assert.equal(r.status, 200); let j = await r.json(); assert.equal(j.success, true); assert.equal(j.jobsStatus, 'invalid');
    reset(); behavior.jobs = new ProxyAdminError(0, 'unreachable');
    r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-jobs'));
    assert.equal((await r.json()).jobsStatus, 'failed');
    assert.deepEqual(calls.at(-1), ['enabled', 'my-app', true]);
    reset();
    r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }, 'proj-schema'));
    assert.equal('jobsStatus' in (await r.json()), false);
});

test('deploy: a Pro creator\'s app gets 5x caps, a Free creator\'s app stays on the defaults, and the proxy is not touched when nothing changes', async () => {
    reset(); subscriptionRow = { tier: 'pro', status: 'active', expires_at: null };
    assert.equal((await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }))).status, 200);
    assert.deepEqual(limitCalls, [['limits-get', 'my-app'], ['limits-set', 'my-app', { rowCap: 100000, dailyCalls: 25000 }]]);
    reset(); subscriptionRow = { tier: 'team', status: 'active', expires_at: null }; await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }));
    assert.equal(limitCalls.find((c) => c[0] === 'limits-set')[2].rowCap, 400000);
    reset(); subscriptionRow = null; await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' }));
    assert.deepEqual(limitCalls, [['limits-get', 'my-app']]); // free, nothing to change
    reset(); subscriptionRow = { tier: 'pro', status: 'active', expires_at: null }; behavior.overrides = { rowCap: 100000, dailyCalls: 25000 };
    await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' })); assert.equal(limitCalls.some((c) => c[0] === 'limits-set'), false);
});

test('deploy: an expired or cancelled paid plan is treated as Free, and a failing limits call never fails the deploy', async () => {
    reset(); subscriptionRow = { tier: 'pro', status: 'active', expires_at: '2020-01-01T00:00:00Z' }; behavior.overrides = { rowCap: 100000, dailyCalls: 25000 };
    await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' })); assert.deepEqual(limitCalls.find((c) => c[0] === 'limits-set'), ['limits-set', 'my-app', {}]);
    reset(); subscriptionRow = { tier: 'pro', status: 'cancelled', expires_at: null }; behavior.overrides = { rowCap: 100000 };
    await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' })); assert.deepEqual(limitCalls.find((c) => c[0] === 'limits-set'), ['limits-set', 'my-app', {}]);
    reset(); subscriptionRow = { tier: 'pro', status: 'active', expires_at: null }; behavior.limitsErr = new ProxyAdminError(0, 'unreachable');
    const r = await quiet(() => post(srv, { userId: 'owner-1', subdomain: 'my-app' })); assert.equal(r.status, 200); assert.equal((await r.json()).success, true);
});
