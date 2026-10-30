import './../helpers/env.mjs';
process.env.BUILD_AUTO_RETRY = '1';
process.env.BUILD_AUTO_RETRY_DELAY_MS = '0';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');
const { _deps, _resetWarnings } = await import('../../lib/buildFailure.js');

// A worker-reported failure of the first build is retried once, automatically, without the user seeing 'failed'. The second
// failure, a manual retry, dispatch errors and a non-building project all behave exactly as before.
const PROMPT = 'a tip calculator'; const USER = 'user-id-12345678';
const ops = []; let projectRow; const reports = []; const dispatched = [];
stubSupabase(supabase, (q) => {
    ops.push({ table: q.table, op: q.op, payload: q.payload });
    if (q.table === 'projects' && q.op === 'insert') return { data: { id: q.payload.id }, error: null };
    if (q.table === 'projects' && q.op === 'select' && q.single) return { data: projectRow, error: null };
    return { data: null, error: null };
});
const { default: projects } = await import('../../routes/projects.routes.js');

const realFetch = globalThis.fetch; let worker, srv;
before(async () => {
    globalThis.fetch = (url, o = {}) => { const u = new URL(String(url)); if (u.hostname === '127.0.0.1') return realFetch(url, o); if (u.hostname === 'worker.test') return worker(u, o); return Promise.resolve(new Response('{}', { status: 200 })); };
    _deps.report = (flow, err, ctx) => reports.push({ flow, message: err.message, ctx });
    const app = express(); app.use(express.json()); app.use('/api/projects', projects); srv = await listen(app);
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
beforeEach(() => {
    ops.length = 0; reports.length = 0; dispatched.length = 0; _resetWarnings();
    projectRow = { id: 'p-1', creator_id: USER, initial_prompt: PROMPT, status: 'building' };
    worker = (u, o) => { dispatched.push(JSON.parse(o.body)); return new Response('{}', { status: 200 }); };
});
const quiet = async (fn) => { const e = console.error, l = console.log, w = console.warn; console.error = console.log = console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; console.warn = w; } };
const cb = (qs, body) => quiet(() => realFetch(`${srv.base}/api/projects/p-1/build-complete${qs}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'test-worker-secret', userId: USER, ...body }) }));
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); };
const failedWrites = () => ops.filter((o) => o.table === 'projects' && o.op === 'update' && o.payload?.status === 'failed');
const build = () => reports.filter((r) => r.flow === 'build_failed');

test('first build fails with ?ar=1: not marked failed, marker stored, worker re-dispatched once with a callback that has no flag', async () => {
    const r = await cb('?ar=1', { status: 'failed', error: 'Claude exited 1' });
    assert.equal(r.status, 200); assert.equal((await r.json()).autoRetry, true);
    await until(() => dispatched.length);
    assert.equal(failedWrites().length, 0); assert.equal(build().length, 0);
    assert.ok(ops.some((o) => o.payload?.error_reason === 'AUTO_RETRIED:WORKER_ERROR'));
    assert.equal(dispatched.length, 1); assert.equal(dispatched[0].prompt, PROMPT); assert.equal(dispatched[0].projectId, 'p-1'); assert.equal(dispatched[0].stream, false);
    assert.match(dispatched[0].callbackUrl, /\/api\/projects\/p-1\/build-complete$/); assert.equal(dispatched[0].callbackUrl.includes('ar='), false);
});

test('NO_RESULT (failed callback without an error text) is retried too', async () => {
    await cb('?ar=1', { status: 'failed' }); await until(() => dispatched.length);
    assert.equal(dispatched.length, 1); assert.equal(failedWrites().length, 0);
});

test('the automatic retry fails (callback without the flag) -> failed as before, reported once, no further dispatch', async () => {
    await cb('', { status: 'failed', error: 'again' });
    assert.equal(failedWrites().length, 1); assert.equal(build().length, 1); assert.equal(build()[0].message, 'WORKER_ERROR'); assert.equal(dispatched.length, 0);
});

test('project no longer building (e.g. stuck-build cron already failed it) -> not retried', async () => {
    projectRow.status = 'failed';
    await cb('?ar=1', { status: 'failed', error: 'x' }); await new Promise((r) => setTimeout(r, 100));
    assert.equal(dispatched.length, 0); assert.equal(failedWrites().length, 1);
});

test('re-dispatch cannot be accepted by the worker -> RETRY_EXHAUSTED, failed once', async () => {
    worker = () => new Response('nope', { status: 500 });
    await cb('?ar=1', { status: 'failed', error: 'x' }); await until(() => failedWrites().length);
    assert.equal(failedWrites().length, 1); assert.equal(build().length, 1); assert.equal(build()[0].message, 'RETRY_EXHAUSTED'); assert.equal(build()[0].ctx.path, 'auto_retry');
});

test('a ready callback is unaffected', async () => {
    const r = await cb('?ar=1', { status: 'ready', bundle: 'QUJD' });
    assert.equal(r.status, 200); assert.equal(dispatched.length, 0); assert.equal(failedWrites().length, 0);
});

test('/generate hands the worker a callback that carries ?ar=1 (async path)', async () => {
    projectRow = null;
    await quiet(() => realFetch(`${srv.base}/api/projects/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: PROMPT, userId: USER }) }));
    await until(() => dispatched.length);
    assert.equal(dispatched.length, 1); assert.match(dispatched[0].callbackUrl, /\/build-complete\?ar=1$/);
});
