import './../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

const rows = {
    'with-repo': { id: 'with-repo', github_repo: 'app-with-repo' },
    'legacy-repo': { id: 'legacy-repo', github_repo: 'app-legacy-repo' },
    'no-repo': { id: 'no-repo', github_repo: null },
};
let dbError = false;
stubSupabase(supabase, (q) => {
    if (q.table !== 'projects') return { data: [], error: null };
    if (q.single) {
        if (dbError) return { data: null, error: { code: 'XX000' } };
        const r = rows[eqOf(q, 'id')];
        return r ? { data: r, error: null } : { data: null, error: { code: 'PGRST116' } };
    }
    return { data: [], error: null };
});
const { default: router } = await import('../../routes/projects.routes.js');

const realFetch = globalThis.fetch;
let worker, srv;
before(async () => {
    globalThis.fetch = (url, opts = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, opts);
        return worker(u, opts);
    };
    const app = express(); app.use(express.json()); app.use('/api/projects', router);
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100));
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
const get = (id) => realFetch(`${srv.base}/api/projects/${id}/versions`);
const quiet = async (fn) => { const e = console.error, w = console.warn, l = console.log; console.error = console.warn = console.log = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; } };

test('versions: returns the worker commit list', async () => {
    worker = () => new Response(JSON.stringify({ success: true, versions: [{ sha: 'abc' }] }), { status: 200 });
    const r = await quiet(() => get('with-repo'));
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.deepEqual(b, { success: true, versions: [{ sha: 'abc' }], hasRepo: true });
});

test('versions: a repo the worker cannot read (older repos live in another GitHub org, worker answers 500) is an empty history, not a 500', async () => {
    worker = () => new Response(JSON.stringify({ error: 'Failed to fetch version history' }), { status: 500 });
    const r = await quiet(() => get('legacy-repo'));
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.success, true); assert.deepEqual(b.versions, []); assert.equal(b.hasRepo, true); assert.equal(b.unavailable, true);
});

test('versions: an unreachable worker is also an empty history', async () => {
    worker = () => { throw new TypeError('fetch failed'); };
    const r = await quiet(() => get('with-repo'));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).unavailable, true);
});

test('versions: no repo, unknown project and database failure keep their answers', async () => {
    worker = () => { throw new Error('worker must not be called'); };
    assert.deepEqual(await (await quiet(() => get('no-repo'))).json(), { success: true, versions: [], hasRepo: false });
    assert.equal((await quiet(() => get('missing'))).status, 404);
});
