import '../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

// Account deletion removes the private GitHub repos, the preview screenshots and the stored app keys, in a safe order:
// outside data first (a failure stops the request with the rows intact), database rows next, the login LAST. All external calls are mocks.
const USER = 'user-1'; const P1 = '0123abcd-0123-4abc-8def-0123456789ab'; const P2 = '9999abcd-0123-4abc-8def-0123456789ab';
const order = []; let projectsSelectError = null;
stubSupabase(supabase, (q) => {
    if (q.op === 'delete') order.push(`db:${q.table}`);
    if (q.table === 'projects' && q.op === 'select') return projectsSelectError ? { data: null, error: projectsSelectError } : { data: [{ id: P1, preview_url: null, github_repo: `app-${P1}` }, { id: P2, preview_url: null, github_repo: null }], error: null };
    if (q.table === 'deployments' && q.op === 'select') return { data: [{ subdomain: 'my-app' }], error: null };
    return { data: null, error: null };
});
// the real login deletion is a mock too
const authDeletes = [];
const fakeAdmin = { auth: { admin: { deleteUser: async (id) => { order.push('auth:deleteUser'); authDeletes.push(id); return { error: null }; } } } };
const { createAuthRouter } = await import('../../routes/auth.routes.js');

const realFetch = globalThis.fetch; let srv;
const worker = []; let workerStatus = 200; let workerThrows = false;
const removed = []; let storageError = null;
const store = { [P1]: ['KEY_A'], 'my-app': ['KEY_A'] }; let proxyDown = false; const keyDeletes = [];
const proxy = {
    configured: true,
    setEnabled: async () => {},
    listSecrets: async (id) => { if (proxyDown) throw Object.assign(new Error('x'), { code: 'unreachable' }); if (!(id in store)) throw Object.assign(new Error('x'), { code: 'unknown_app', status: 404 }); order.push('keys:list'); return store[id].map((name) => ({ name })); },
    deleteSecret: async (id, name) => { order.push('keys:delete'); keyDeletes.push(`${id}/${name}`); },
};
const storage = { from: (b) => ({ remove: async (paths) => { order.push('shots:remove'); if (storageError) return { data: null, error: storageError }; removed.push({ b, paths }); return { data: [], error: null }; } }) };
const logs = [];

before(async () => {
    globalThis.fetch = (url, opts = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, opts);
        if (u.origin === 'http://worker.test:3456') {
            order.push('github:delete'); worker.push({ method: opts.method, path: u.pathname, secret: opts.headers?.['x-worker-secret'] });
            if (workerThrows) return Promise.reject(new Error('ECONNREFUSED'));
            return Promise.resolve(new Response('{"success":true}', { status: workerStatus }));
        }
        return Promise.resolve(new Response('{}', { status: 200 })); // deploy server
    };
    const { deleteAccountExternalData } = await import('../../lib/accountCleanup.js');
    const app = express(); app.use(express.json()); app.locals.proxyAdmin = proxy;
    app.use('/api/auth', createAuthRouter({
        verifyUser: async () => USER,
        admin: fakeAdmin,
        externalCleanup: (args) => deleteAccountExternalData({ ...args, storage, log: (m) => logs.push(m) }),
    }));
    srv = await listen(app);
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
const reset = () => { order.length = 0; worker.length = 0; removed.length = 0; keyDeletes.length = 0; logs.length = 0; workerStatus = 200; workerThrows = false; storageError = null; proxyDown = false; projectsSelectError = null; authDeletes.length = 0; };
const del = async () => { const log = console.log; const warn = console.warn; console.log = console.warn = () => {}; try { return await realFetch(`${srv.base}/api/auth/account`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' }); } finally { console.log = log; console.warn = warn; } };

test('happy path (a repo the worker reports as already gone is a 200 too): repos, screenshots and keys are removed for every project, before any row, and all calls are the mocked ones', async () => {
    reset(); const r = await del(); assert.equal(r.status, 200); await r.text();
    assert.deepEqual(worker.map((w) => `${w.method} ${w.path}`).sort(), [`DELETE /repo/app-${P1}`, `DELETE /repo/app-${P2}`].sort());   // P2 had no saved repo name: found by its id
    assert.ok(worker.every((w) => w.secret === process.env.WORKER_SECRET));
    assert.deepEqual(removed, [{ b: 'project-assets', paths: [`thumbnails/${P1}.jpg`, `thumbnails/${P2}.jpg`] }]);
    assert.deepEqual(keyDeletes.sort(), [`${P1}/KEY_A`, 'my-app/KEY_A']);
    const firstRow = order.findIndex((o) => o.startsWith('db:'));
    for (const step of ['github:delete', 'shots:remove', 'keys:delete']) assert.ok(order.lastIndexOf(step) < firstRow, `${step} runs before any row is deleted`);
});

test('a GitHub failure stops the request before any row or the login is touched, names the step, and a retry can run again', async () => {
    reset(); workerStatus = 502;
    let r = await del(); const body = await r.json();
    assert.equal(r.status, 500); assert.deepEqual(body.failed, ['github']);
    assert.ok(!order.some((o) => o.startsWith('db:') || o.startsWith('auth:')), order.join(','));
    reset(); r = await del(); assert.equal(r.status, 200); await r.text();   // retry succeeds
});

test('a worker that does not have the route yet (404) is a failure, not a silent skip', async () => {
    reset(); workerStatus = 404;
    const r = await del(); const body = await r.json(); assert.equal(r.status, 500); assert.deepEqual(body.failed, ['github']);
    assert.ok(!order.some((o) => o.startsWith('db:')));
});

test('a screenshot-storage failure and a key-vault outage each stop the request with rows intact', async () => {
    reset(); storageError = { statusCode: '500' };
    let r = await del(); let body = await r.json(); assert.equal(r.status, 500); assert.deepEqual(body.failed, ['screenshots']); assert.ok(!order.some((o) => o.startsWith('db:')));
    reset(); proxyDown = true;
    r = await del(); body = await r.json(); assert.equal(r.status, 500); assert.deepEqual(body.failed, ['keys']); assert.ok(!order.some((o) => o.startsWith('db:')));
});

test('when the project list cannot be read nothing is deleted anywhere', async () => {
    reset(); projectsSelectError = { message: 'down' };
    const r = await del(); const body = await r.json(); assert.equal(r.status, 500); assert.deepEqual(body.failed, ['projects']);
    assert.deepEqual(order, []); assert.deepEqual(worker, []);
});

test('failure logs carry counts and codes only: no user id, project id, repo name or key name', async () => {
    reset(); workerStatus = 502; storageError = { statusCode: '500' }; proxyDown = true;
    const r = await del(); await r.text();
    assert.ok(logs.length >= 3);
    for (const m of logs) for (const secret of [USER, P1, P2, 'my-app', 'KEY_A', 'app-']) assert.ok(!m.includes(secret), `${secret} in: ${m}`);
});

test('the login is deleted LAST, after the external data and every database row; a failed step means it is not deleted at all', async () => {
    reset(); let r = await del(); await r.text();
    assert.equal(r.status, 200); assert.deepEqual(authDeletes, [USER]);
    assert.equal(order[order.length - 1], 'auth:deleteUser');
    assert.ok(order.lastIndexOf('github:delete') < order.indexOf('db:projects'));
    reset(); workerStatus = 502; r = await del(); await r.text();
    assert.equal(r.status, 500); assert.deepEqual(authDeletes, []);
});
