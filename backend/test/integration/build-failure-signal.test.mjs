import './../helpers/env.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');
const { _deps, _resetWarnings } = await import('../../lib/buildFailure.js');

// Every place a project is set to 'failed' must report build_failed once with a stable class and no content, and persist the
// reason without ever letting a missing error_reason column break the status write.
const SECRET_PROMPT = 'A pomodoro timer for secretuser@example.com with codeword zanzibar';
const USER = 'user-id-12345678';
const ops = []; let missingColumn = false; let projectRow = null; const reports = [];
stubSupabase(supabase, (q) => {
    ops.push({ table: q.table, op: q.op, payload: q.payload, filters: q.filters.map((f) => f.slice(0, 3)) });
    if (q.table === 'projects' && q.op === 'update' && q.payload && 'error_reason' in q.payload && missingColumn) {
        return { data: null, error: { code: '42703', message: 'column "error_reason" of relation "projects" does not exist' } };
    }
    if (q.table === 'projects' && q.op === 'insert') return { data: { id: q.payload.id }, error: null };
    if (q.table === 'projects' && q.op === 'select' && q.single) return { data: projectRow, error: null };
    if (q.table === 'projects' && q.op === 'select') return { data: [{ id: 's1', creator_id: USER, initial_prompt: SECRET_PROMPT, created_at: '2020-01-01' }, { id: 's2', creator_id: USER, initial_prompt: SECRET_PROMPT, created_at: '2020-01-01' }], error: null, count: 0 };
    return { data: null, error: null };
});
const { default: projects } = await import('../../routes/projects.routes.js');

const realFetch = globalThis.fetch; let worker, srv;
before(async () => {
    globalThis.fetch = (url, o = {}) => { const u = new URL(String(url)); if (u.hostname === '127.0.0.1') return realFetch(url, o); if (u.hostname === 'worker.test') return worker(u, o); return Promise.resolve(new Response('{}', { status: 200 })); };
    _deps.report = (flow, err, ctx) => reports.push({ flow, message: err.message, stack: err.stack, ctx });
    const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use('/api/projects', projects); srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100));
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
beforeEach(() => { ops.length = 0; reports.length = 0; missingColumn = false; _resetWarnings(); projectRow = null; worker = () => new Response('{}', { status: 200 }); });
const quiet = async (fn) => { const e = console.error, l = console.log, w = console.warn; console.error = console.log = console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; console.warn = w; } };
const call = (p, body, headers = {}) => quiet(() => realFetch(`${srv.base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
const failed = () => ops.filter((o) => o.table === 'projects' && o.op === 'update' && o.payload?.status === 'failed');
const reasons = () => ops.filter((o) => o.table === 'projects' && o.op === 'update' && 'error_reason' in (o.payload || {})).map((o) => o.payload.error_reason);
const build = () => reports.filter((r) => r.flow === 'build_failed');
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 30)); };
const gen = (extra = {}) => call('/api/projects/generate', { prompt: SECRET_PROMPT, userId: USER, ...extra });
const noContent = () => { const all = JSON.stringify(reports); for (const bad of ['secretuser', 'zanzibar', 'pomodoro', USER, 'example.com']) assert.equal(all.includes(bad), false, `report leaked ${bad}`); };

test('generate (async): worker HTTP error -> one build_failed DISPATCH_ERROR with the http status, reason stored, no content', async () => {
    worker = () => new Response(JSON.stringify({ error: `bad prompt ${SECRET_PROMPT}` }), { status: 500, headers: { 'content-type': 'application/json' } });
    await gen(); await until(() => reasons().length);
    assert.equal(failed().length, 1); assert.equal(build().length, 1);
    assert.equal(build()[0].message, 'DISPATCH_ERROR'); assert.equal(build()[0].ctx.http_status, '500'); assert.equal(build()[0].ctx.phase, 'dispatch_http');
    assert.deepEqual(reasons(), ['DISPATCH_ERROR']); noContent();
});

test('generate (async): quota exhausted is also a DISPATCH_ERROR', async () => {
    worker = () => new Response(JSON.stringify({ error: 'quota', quotaExhausted: true }), { status: 429, headers: { 'content-type': 'application/json' } });
    await gen(); await until(() => reasons().length);
    assert.equal(build().length, 1); assert.equal(build()[0].message, 'DISPATCH_ERROR'); assert.equal(build()[0].ctx.phase, 'quota_exhausted');
});

test('generate (stream): worker ends the stream with nothing -> NO_RESULT; with an error event -> WORKER_ERROR (message sanitized in the db only)', async () => {
    worker = () => new Response('', { status: 200 });
    await gen({ stream: true }); await until(() => reasons().length);
    assert.equal(build().length, 1); assert.equal(build()[0].message, 'NO_RESULT'); assert.equal(failed().length, 1);
    ops.length = 0; reports.length = 0;
    worker = () => new Response(`data: ${JSON.stringify({ type: 'error', error: `could not build "${SECRET_PROMPT}" see https://x.test/a` })}\n\n`, { status: 200 });
    await gen({ stream: true }); await until(() => reasons().length);
    assert.equal(build().length, 1); assert.equal(build()[0].message, 'WORKER_ERROR');
    assert.match(reasons()[0], /^WORKER_ERROR: could not build \[text\] see \[url\]$/); noContent();
});

test('generate (async): dispatch exhausts its retries on network errors -> one DISPATCH_ERROR from the catch', async () => {
    worker = () => { throw new TypeError('fetch failed'); };
    await gen(); await until(() => reasons().length);
    assert.equal(failed().length, 1); assert.equal(build().length, 1);
    assert.equal(build()[0].message, 'DISPATCH_ERROR'); assert.equal(build()[0].ctx.attempt, '3'); assert.equal(build()[0].ctx.error_name, 'TypeError'); noContent();
});

test('build-complete: a worker failure callback -> WORKER_ERROR (sanitized reason stored), no error text -> NO_RESULT; ready reports nothing', async () => {
    const cb = (body) => call('/api/projects/p-1/build-complete', { secret: 'test-worker-secret', userId: USER, ...body });
    assert.equal((await cb({ status: 'failed', error: 'Claude exited 1 for dev@example.com' })).status, 200);
    assert.equal(build().length, 1); assert.equal(build()[0].message, 'WORKER_ERROR'); assert.equal(reasons()[0], 'WORKER_ERROR: Claude exited 1 for [email]'); noContent();
    ops.length = 0; reports.length = 0;
    await cb({ status: 'failed' }); assert.equal(build()[0].message, 'NO_RESULT'); assert.equal(reasons()[0], 'NO_RESULT');
    ops.length = 0; reports.length = 0;
    await cb({ status: 'ready', bundle: 'QUJD' }); assert.equal(build().length, 0); assert.equal(failed().length, 0);
    const bad = await call('/api/projects/p-1/build-complete', { secret: 'wrong', status: 'failed' }); assert.equal(bad.status, 401); assert.equal(build().length, 0);
});

test('cleanup cron: stuck builds -> ONE TIMEOUT_STUCK report for the batch with the count, one status write for all ids', async () => {
    const r = await call('/api/projects/api/admin/cleanup-stuck-builds', {}, { 'x-admin-secret': 'test-worker-secret' });
    assert.equal(r.status, 200); assert.equal((await r.json()).cleaned, 2);
    assert.equal(build().length, 1); assert.equal(build()[0].message, 'TIMEOUT_STUCK'); assert.equal(build()[0].ctx.count, '2');
    assert.equal(failed().length, 1); assert.deepEqual(failed()[0].filters.find((f) => f[0] === 'in').slice(1), ['id', ['s1', 's2']]); assert.deepEqual(reasons(), ['TIMEOUT_STUCK']); noContent();
});

test('retry: a worker HTTP error after the retries -> RETRY_EXHAUSTED once (no double report from the outer catch)', async () => {
    projectRow = { id: 'p-r', creator_id: USER, status: 'failed', initial_prompt: SECRET_PROMPT };
    worker = () => new Response('nope', { status: 500 });
    const r = await call('/api/projects/p-r/retry', { userId: USER }); assert.equal(r.status, 200);
    await until(() => reasons().length);
    assert.equal(build().length, 1); assert.equal(build()[0].message, 'RETRY_EXHAUSTED'); assert.equal(build()[0].ctx.http_status, '500'); assert.equal(build()[0].ctx.path, 'retry');
    assert.equal(failed().length, 1); noContent();
});

test('a missing error_reason column never breaks the status write: status is written, the response is normal, the warning is logged once', async () => {
    missingColumn = true; const warns = []; const w = console.warn;
    const cb = async () => { console.warn = (m) => warns.push(String(m)); try { return await realFetch(`${srv.base}/api/projects/p-1/build-complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'test-worker-secret', status: 'failed', error: 'x' }) }); } finally { console.warn = w; } };
    const a = await cb(); const b = await cb();
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(failed().length, 2); assert.equal(build().length, 2);
    assert.equal(warns.filter((m) => m.includes('error_reason is not available')).length, 1);
});

test('generate (async): a busy worker (429) does not mark the project failed or report; the stuck-build cron owns that case', async () => {
    worker = () => new Response(JSON.stringify({ error: 'busy' }), { status: 429, headers: { 'content-type': 'application/json' } });
    const r = await gen(); assert.equal(r.status, 200); await new Promise((x) => setTimeout(x, 200));
    assert.equal(failed().length, 0); assert.equal(build().length, 0);
});
