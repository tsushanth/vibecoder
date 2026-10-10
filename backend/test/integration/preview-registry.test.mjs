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
let workerBundle = 'QUJD';
let revertMode = false;
const { supabase } = await import('../../config/database.js');

const PID = 'abcdef12-3456-7890-abcd-ef1234567890';
stubSupabase(supabase, (q) => {
    if (q.table === 'projects' && q.op === 'insert') return { data: { id: PID }, error: null };
    if (revertMode && q.table === 'projects' && q.single) return { data: { id: PID, creator_id: 'owner-1', github_repo: 'repo-x', preview_url: `https://prev-${PID.substring(0, 8)}.vibebuild.cc`, published_url: null }, error: null };
    if (q.single) return { data: null, error: { code: 'PGRST116' } };
    return { data: [], error: null };
});
const { default: router } = await import('../../routes/projects.routes.js');
supabase.auth.getUser = async (t) => (String(t).startsWith('tok-') ? { data: { user: { id: String(t).slice(4) } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }); // each caller authenticates as the user it claims to be

const realFetch = globalThis.fetch;
let deployOk = true;
const calls = []; let behavior = {};
const fakeProxy = () => ({ configured: true, ensureApp: async (a) => { calls.push(['ensure', a]); if (behavior.ensure) throw behavior.ensure; }, setEnabled: async (a, e) => { calls.push(['enabled', a, e]); if (behavior.enabled) throw behavior.enabled; }, setManifest: async (a, m) => { calls.push(['manifest', a, m]); }, copySecrets: async (to, from, o) => { calls.push(['copy', to, from, o]); return { copied: 0 }; }, setJobs: async (a, spec) => { calls.push(['jobs', a, spec]); if (behavior.jobs) throw behavior.jobs; return { jobs: 1, warnings: [] }; } });
const sseResult = (extra = {}) => `data: ${JSON.stringify({ type: 'result', success: true, bundle: workerBundle, bundleSize: 3, files: [{ path: 'index.html', size: 3 }], generationTime: '1.0', quality: { criticalIssues: 0 }, ...extra })}\n\n`;
let srv;
before(async () => {
    globalThis.fetch = (url, opts = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, opts);
        if (u.pathname === '/generate') return Promise.resolve(new Response(sseResult(), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        if (u.pathname === '/revert') return Promise.resolve(new Response(JSON.stringify({ bundle: workerBundle, bundleSize: 3 }), { status: 200, headers: { 'content-type': 'application/json' } }));
        if (u.pathname === '/deploy') return Promise.resolve(new Response(deployOk ? '{}' : '{"error":"boom"}', { status: deployOk ? 200 : 500, headers: { 'content-type': 'application/json' } }));
        return Promise.resolve(new Response('', { status: 500 })); // screenshot service and anything else
    };
    const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '5mb' })); app.locals.proxyAdmin = fakeProxy(); app.use('/api/projects', router);
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 150));
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
const reset = () => { calls.length = 0; behavior = {}; deployOk = true; workerBundle = 'QUJD'; revertMode = false; };
const quiet = async (fn) => { const w = console.warn, l = console.log, e = console.error; console.warn = console.log = console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.log = l; console.error = e; } };
const waitFor = async (pred, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 40)); } return pred(); };
const buildComplete = (body) => realFetch(`${srv.base}/api/projects/${PID}/build-complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: process.env.WORKER_SECRET, ...body }) });

test('build-complete: the preview subdomain is registered and enabled in the proxy after the preview deploys', async () => {
    reset();
    const r = await quiet(() => buildComplete({ bundle: 'QUJD', status: 'ready' }));
    assert.equal(r.status, 200);
    assert.ok(await waitFor(() => calls.length >= 2), 'registration must happen');
    assert.deepEqual(calls, [['ensure', `prev-${PID.substring(0, 8)}`], ['enabled', `prev-${PID.substring(0, 8)}`, true]]);
});

test('build-complete: a proxy failure does not fail the callback, and a failed preview deploy registers nothing', async () => {
    reset(); behavior.ensure = new ProxyAdminError(0, 'unreachable');
    assert.equal((await quiet(() => buildComplete({ bundle: 'QUJD', status: 'ready' }))).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    reset(); deployOk = false;
    assert.equal((await quiet(() => buildComplete({ bundle: 'QUJD', status: 'ready' }))).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(calls, []);
});

test('build-complete: a failed build, or a wrong secret, registers nothing', async () => {
    reset();
    await quiet(() => buildComplete({ status: 'failed', error: 'x' }));
    assert.equal((await quiet(() => realFetch(`${srv.base}/api/projects/${PID}/build-complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'wrong', bundle: 'QUJD', status: 'ready' }) }))).status, 401);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(calls, []);
});

test('generate (streaming): the preview subdomain created after the worker result is registered and enabled', async () => {
    reset();
    const r = await quiet(() => realFetch(`${srv.base}/api/projects/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a small counter app please', userId: 'user-1', stream: true }) }));
    await r.text();
    assert.ok(await waitFor(() => calls.length >= 2, 6000), `expected registration calls, saw ${JSON.stringify(calls)}`);
    assert.deepEqual(calls, [['ensure', `preview-${PID.substring(0, 12)}`], ['enabled', `preview-${PID.substring(0, 12)}`, true]]);
});

test('generate (streaming): finishing a build raises no unhandled error in its background work', async () => {
    reset();
    const rejections = []; const onRej = (e) => rejections.push(String(e?.message || e));
    process.on('unhandledRejection', onRej);
    try {
        const r = await quiet(() => realFetch(`${srv.base}/api/projects/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'another small counter app', userId: 'user-2', stream: true }) }));
        await r.text();
        assert.ok(await waitFor(() => calls.length >= 2, 6000));
        await new Promise((res) => setTimeout(res, 800)); // let the rest of the background block finish
    } finally { process.off('unhandledRejection', onRej); }
    assert.deepEqual(rejections, [], 'unhandled: ' + rejections.join(' | '));
});

test('build-complete: a bundle with a manifest registers it under the project id and the preview subdomain, with the project keys', async () => {
    reset();
    const r = await quiet(() => buildComplete({ bundle: MANIFEST_BUNDLE, status: 'ready' }));
    assert.equal(r.status, 200);
    const sub = `prev-${PID.substring(0, 8)}`;
    assert.ok(await waitFor(() => calls.length >= 7), JSON.stringify(calls));
    assert.deepEqual(calls, [['ensure', sub], ['ensure', PID], ['enabled', PID, false], ['manifest', PID, MANIFEST], ['manifest', sub, MANIFEST], ['copy', sub, PID, { replace: true }], ['enabled', sub, true]]);
});

test('generate (streaming): the manifest in the worker bundle is registered for the preview subdomain', async () => {
    reset(); workerBundle = MANIFEST_BUNDLE;
    const r = await quiet(() => realFetch(`${srv.base}/api/projects/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a stock quote app please', userId: 'user-3', stream: true }) }));
    await r.text();
    const sub = `preview-${PID.substring(0, 12)}`;
    assert.ok(await waitFor(() => calls.length >= 7, 6000), JSON.stringify(calls));
    assert.deepEqual(calls, [['ensure', sub], ['ensure', PID], ['enabled', PID, false], ['manifest', PID, MANIFEST], ['manifest', sub, MANIFEST], ['copy', sub, PID, { replace: true }], ['enabled', sub, true]]);
});

test('revert: after the old bundle is redeployed the manifest of that version is registered for the preview subdomain', async () => {
    reset(); revertMode = true; workerBundle = MANIFEST_BUNDLE;
    const r = await quiet(() => realFetch(`${srv.base}/api/projects/${PID}/revert/abc1234`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-owner-1' }, body: JSON.stringify({ userId: 'owner-1' }) }));
    assert.equal(r.status, 200, await r.text());
    const sub = `prev-${PID.substring(0, 8)}`;
    assert.deepEqual(calls, [['ensure', sub], ['ensure', PID], ['enabled', PID, false], ['manifest', PID, MANIFEST], ['manifest', sub, MANIFEST], ['copy', sub, PID, { replace: true }], ['enabled', sub, true]]);
});

test('revert: a failed redeploy registers nothing', async () => {
    reset(); revertMode = true; workerBundle = MANIFEST_BUNDLE; deployOk = false;
    const r = await quiet(() => realFetch(`${srv.base}/api/projects/${PID}/revert/abc1234`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-owner-1' }, body: JSON.stringify({ userId: 'owner-1' }) }));
    assert.equal(r.status, 200); assert.deepEqual(calls, []);
});

test('build-complete: a vibe.jobs.json in the preview bundle is pushed to the preview subdomain app (not the project-id app) before it is enabled; a failure never fails the callback', async () => {
    const JOBS = { version: 1, jobs: [{ id: 'cleanup', schedule: { every: '1h' }, action: { type: 'prune', table: 'todos', olderThanDays: 30 } }] };
    reset();
    const r = await quiet(() => buildComplete({ bundle: zip([file('index.html', 'x'), file('vibe.jobs.json', JOBS)]), status: 'ready' }));
    assert.equal(r.status, 200);
    const sub = `prev-${PID.substring(0, 8)}`;
    assert.ok(await waitFor(() => calls.length >= 5), JSON.stringify(calls));
    assert.deepEqual(calls.filter((c) => c[0] !== 'manifest'), [['ensure', sub], ['jobs', sub, JOBS], ['enabled', sub, true]]);
    reset(); behavior.jobs = new ProxyAdminError(0, 'unreachable');
    assert.equal((await quiet(() => buildComplete({ bundle: zip([file('vibe.jobs.json', JOBS)]), status: 'ready' }))).status, 200);
    assert.ok(await waitFor(() => calls.some((c) => c[0] === 'enabled')), JSON.stringify(calls));
});
