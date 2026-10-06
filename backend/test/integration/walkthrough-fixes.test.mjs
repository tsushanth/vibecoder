import './../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

// Found by a full creator walk-through on the live product: deleting a published project, deleting an account that owns
// one, and a failed project insert on generate all failed without anyone noticing or being able to recover.
const ops = []; let deploymentsError = null; let failTables = new Set(); let placeholderFails = false; let projectOwner = 'owner';
stubSupabase(supabase, (q) => {
    const f = (c) => q.filters.find((x) => x[1] === c);
    ops.push({ table: q.table, op: q.op, filters: q.filters.map((x) => x.slice(0, 3)) });
    if (q.table === 'deployments' && q.op === 'delete') return deploymentsError ? { data: null, error: { message: 'fk' } } : { data: null, error: null };
    if (q.op === 'delete' && failTables.has(q.table)) return { data: null, error: { message: 'boom' } };
    if (q.table === 'projects' && q.op === 'select' && q.single) return { data: { id: 'p1', creator_id: projectOwner, github_repo: null }, error: null };
    if (q.table === 'projects' && q.op === 'select') return { data: [{ id: 'p1' }, { id: 'p2' }], error: null };
    if (q.table === 'projects' && q.op === 'insert') return placeholderFails ? { data: null, error: { code: '23503' } } : { data: { id: q.payload.id }, error: null };
    return { data: null, error: null };
});
const { default: projects } = await import('../../routes/projects.routes.js');
const { default: auth } = await import('../../routes/auth.routes.js');

const realFetch = globalThis.fetch; let workerCalls = 0, srv;
before(async () => {
    globalThis.fetch = (url, o = {}) => { const u = new URL(String(url)); if (u.hostname === '127.0.0.1') return realFetch(url, o); if (u.hostname === 'worker.test') workerCalls++; return Promise.resolve(new Response('{}', { status: 200 })); };
    const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use('/api/projects', projects); app.use('/api/auth', auth); srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100));
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
const quiet = async (fn) => { const e = console.error, l = console.log, w = console.warn; console.error = console.log = console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; console.warn = w; } };
const call = (m, p, body) => quiet(() => realFetch(`${srv.base}${p}`, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const reset = () => { ops.length = 0; deploymentsError = null; failTables = new Set(); placeholderFails = false; projectOwner = 'owner'; workerCalls = 0; };

test('deleting a published project removes its deployments first, then the project', async () => {
    reset(); const r = await call('DELETE', '/api/projects/p1', { userId: 'owner' });
    assert.equal(r.status, 200);
    const del = ops.filter((o) => o.op === 'delete').map((o) => o.table); assert.deepEqual(del, ['deployments', 'projects']);
    assert.equal(ops.some((o) => o.table === 'deployments' && o.op === 'update'), false);
});

test('if the deployments cannot be removed the project is not deleted and the creator gets an error', async () => {
    reset(); deploymentsError = true; const r = await call('DELETE', '/api/projects/p1', { userId: 'owner' });
    assert.equal(r.status, 500); assert.equal(ops.some((o) => o.table === 'projects' && o.op === 'delete'), false);
});

test('only the creator can delete, and nothing is touched otherwise', async () => {
    reset(); projectOwner = 'someone-else'; const r = await call('DELETE', '/api/projects/p1', { userId: 'owner' });
    assert.equal(r.status, 403); assert.equal(ops.some((o) => o.op === 'delete'), false);
});

test('account deletion removes data in dependency order: deployments of the user\'s projects before the projects, the user last', async () => {
    reset(); const r = await call('DELETE', '/api/auth/account', { userId: 'u1' });
    assert.equal(r.status, 200);
    const del = ops.filter((o) => o.op === 'delete').map((o) => o.table);
    assert.deepEqual(del, ['project_chats', 'deployments', 'projects', 'coin_transactions', 'user_coins', 'users']);
    const sel = ops.find((o) => o.table === 'projects' && o.op === 'select'); assert.deepEqual(sel.filters.find((f) => f[0] === 'eq').slice(1), ['creator_id', 'u1']); // only the user's own projects
    const dep = ops.find((o) => o.table === 'deployments' && o.op === 'delete'); assert.deepEqual(dep.filters.find((f) => f[0] === 'in').slice(1), ['project_id', ['p1', 'p2']]);
});

test('if any part of the data cannot be deleted the account request fails, naming what failed, so it can be retried', async () => {
    reset(); failTables = new Set(['projects']); const r = await call('DELETE', '/api/auth/account', { userId: 'u1' });
    assert.equal(r.status, 500); const j = await r.json(); assert.deepEqual(j.failed, ['projects']); assert.match(j.error, /try again/i);
});

test('generate: when the project row cannot be created the async client gets a clear error and no build is started', async () => {
    reset(); placeholderFails = true;
    const r = await call('POST', '/api/projects/generate', { prompt: 'A simple pomodoro timer for studying', userId: 'u-gen-1' });
    assert.equal(r.status, 500); assert.match((await r.json()).error, /try again/i); assert.equal(workerCalls, 0);
});

test('generate: an old streaming client still proceeds without a project row, and a normal request still queues', async () => {
    reset(); placeholderFails = true;
    const s = await call('POST', '/api/projects/generate', { prompt: 'A simple pomodoro timer for studying', userId: 'u-gen-2', stream: true });
    assert.notEqual(s.status, 500); assert.ok(workerCalls >= 1);
    reset(); const ok = await call('POST', '/api/projects/generate', { prompt: 'A simple pomodoro timer for studying', userId: 'u-gen-3' });
    assert.equal(ok.status, 200); assert.match(await ok.text(), /"type":"queued"/);
});
