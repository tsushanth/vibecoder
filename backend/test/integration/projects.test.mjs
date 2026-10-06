import './../helpers/env.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');

const P = (o) => ({ id: 'x', title: 'Nice App', creator_id: 'u1', creator_name: 'Sam', preview_url: 'p.png',
    initial_prompt: 'Build a nice app with many features', created_at: new Date().toISOString(), status: 'ready', ...o });
const rows = {
    'ok-1': P({ id: 'ok-1' }),
    'dup-1': P({ id: 'dup-1', initial_prompt: 'BUILD a nice app  with many features' }),
    'mail-1': P({ id: 'mail-1', initial_prompt: 'someone@example.com' }),
    'short-1': P({ id: 'short-1', initial_prompt: 'hey' }),
    'ok-2': P({ id: 'ok-2', title: 'Second', initial_prompt: 'A completely different long prompt' }),
};
let projectRow = null; // used by progress/export-apk lookups
let strictSelect = false; // when true a single-row lookup returns only the columns the route asked for
stubSupabase(supabase, (q) => {
    if (q.table !== 'projects') return { data: [], error: null };
    if (q.single && eqOf(q, 'id') === projectRow?.id && strictSelect) {
        const cols = String(q.filters.find((f) => f[0] === 'select')?.[1] || '*').split(',').map((c) => c.trim());
        return { data: cols.includes('*') ? projectRow : Object.fromEntries(cols.filter((c) => c in projectRow).map((c) => [c, projectRow[c]])), error: null };
    }
    if (q.single) return eqOf(q, 'id') === projectRow?.id ? { data: projectRow, error: null } : { data: null, error: { code: 'PGRST116' } };
    if (q.op === 'select') return { data: Object.values(rows), error: null };
    return { data: null, error: null };
});
const { default: router } = await import('../../routes/projects.routes.js');

const realFetch = globalThis.fetch;
let external, srv;
before(async () => {
    globalThis.fetch = (url, opts = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, opts);
        return external(u, opts);
    };
    const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '50mb' })); app.use('/api/projects', router);
    srv = await listen(app);
    await new Promise((r) => setTimeout(r, 100)); // let the initial browse-cache refresh finish
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
const url = (p) => `${srv.base}/api/projects${p}`;
const post = (p, body, headers = {}) => realFetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const quiet = async (fn) => { const e = console.error, l = console.log; console.error = console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };
const claude = (text, status = 200) => () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status });
let uid = 0; const user = () => `plan-user-${++uid}`;

// ---------------- browse ----------------
test('browse feed: filtered + deduped, every project has a prompt, no emails', async () => {
    const b = await (await realFetch(url('/browse'))).json();
    assert.equal(b.success, true);
    assert.deepEqual(b.projects.map((p) => p.id).sort(), ['ok-1', 'ok-2']);
    for (const p of b.projects) { assert.ok(p.initial_prompt.length >= 15); assert.doesNotMatch(p.initial_prompt, /@/); }
    const pop = await (await realFetch(url('/browse?sort=popular&limit=1'))).json();
    assert.equal(pop.projects.length, 1); assert.equal(pop.hasMore, true);
    const s = await (await realFetch(url('/browse?search=second'))).json();
    assert.deepEqual(s.projects.map((p) => p.id), ['ok-2']);
});

// ---------------- plan ----------------
const GOOD_PLAN = JSON.stringify({ summary: 'A todo app', features: ['add', 'remove', 'filter'], style: 'Minimal' });

test('plan: validation 400s', async () => {
    for (const body of [{}, { prompt: '' }, { prompt: '   ' }, { prompt: 5 }, { prompt: 'x'.repeat(1001) }, null])
        assert.equal((await post('/plan', body)).status, 400, JSON.stringify(body)?.slice(0, 30));
});

test('plan: 503 when ANTHROPIC_API_KEY unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    external = () => { throw new Error('must not call Anthropic without a key'); };
    assert.equal((await post('/plan', { prompt: 'todo app', userId: user() })).status, 503);
});

test('plan: well-formed plan with stubbed Anthropic; key only in server->Anthropic header; prompt sent as data', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    let seen;
    external = (u, o) => { seen = { u, o }; return claude('Here you go:\n```json\n' + GOOD_PLAN + '\n```')(); };
    const r = await post('/plan', { prompt: '  todo app  ', userId: user() });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.deepEqual(body, { success: true, plan: { summary: 'A todo app', features: ['add', 'remove', 'filter'], style: 'Minimal' } });
    assert.equal(seen.u.href, 'https://api.anthropic.com/v1/messages');
    assert.equal(seen.o.headers['x-api-key'], 'sk-test-key');
    const sent = JSON.parse(seen.o.body);
    assert.equal(sent.messages[0].content, 'todo app'); assert.ok(sent.max_tokens <= 400);
    assert.doesNotMatch(JSON.stringify(body), /sk-test/);
});

test('plan: unusable model output / upstream failure -> 503 (never 500, no leak)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    for (const ext of [claude('no json here'), claude('{"summary":"s","features":[]}'), claude('{broken json}'), claude('{}', 529), () => { throw new Error('ECONNRESET sk-test-key'); }]) {
        external = ext;
        const r = await quiet(() => post('/plan', { prompt: 'todo', userId: user() }));
        assert.equal(r.status, 503);
        assert.doesNotMatch(await r.text(), /sk-test|ECONNRESET/);
    }
});

test('plan: 20/hour rate limit per user, other users unaffected', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'; external = claude(GOOD_PLAN);
    const u = user();
    for (let i = 0; i < 20; i++) assert.equal((await post('/plan', { prompt: 'a', userId: u })).status, 200);
    assert.equal((await post('/plan', { prompt: 'a', userId: u })).status, 429);
    assert.equal((await post('/plan', { prompt: 'a', userId: user() })).status, 200);
});

// ---------------- progress ----------------
const getProgress = (id, q = '') => realFetch(url(`/${id}/progress${q}`));
const SECRET = { 'x-worker-secret': 'test-worker-secret' };

test('progress GET: 404 for unknown project', async () => {
    projectRow = null;
    assert.equal((await getProgress('does-not-exist')).status, 404);
});

test('progress POST: auth required (401 no/wrong secret; header or body secret accepted), 400 bad id', async () => {
    assert.equal((await post('/p1/progress', { phase: 'fix' })).status, 401);
    assert.equal((await post('/p1/progress', { phase: 'fix' }, { 'x-worker-secret': 'wrong' })).status, 401);
    assert.equal((await post('/p1/progress', { phase: 'fix', secret: 'test-worker-secret' })).status, 200);
    assert.equal((await post('/null/progress', { phase: 'fix' }, SECRET)).status, 400);
    assert.equal((await post('/undefined/progress', {}, SECRET)).status, 400);
});

test('progress GET: derived phase when worker silent; worker events override; monotonic; ready clears', async () => {
    projectRow = { id: 'pb', creator_id: 'u1', status: 'building', created_at: new Date(Date.now() - 100_000).toISOString(), updated_at: null };
    let b = await (await getProgress('pb')).json();
    assert.deepEqual([b.status, b.phase, b.events.length], ['building', 'polish', 0]); // 100s elapsed -> polish (>=95s)
    assert.ok(b.percent > 50 && b.percent <= 95);
    assert.equal((await getProgress('pb')).headers.get('cache-control'), 'no-store');

    await post('/pb/progress', { phase: 'validate', message: 'Checking', percent: 60 }, SECRET);
    await post('/pb/progress', { phase: 'fix', message: 'Fixing', percent: 30 }, SECRET);
    b = await (await getProgress('pb')).json();
    assert.deepEqual([b.phase, b.percent, b.events.length], ['fix', 60, 2]);

    await post('/pb/progress', { phase: 'package', percent: 100 }, SECRET);
    assert.equal((await (await getProgress('pb')).json()).percent, 99, 'building never reports 100');

    projectRow = { ...projectRow, status: 'ready' };
    b = await (await getProgress('pb')).json();
    assert.deepEqual([b.status, b.phase, b.percent], ['ready', 'ready', 100]);
    projectRow = { ...projectRow, status: 'building' };
    b = await (await getProgress('pb')).json();
    assert.equal(b.events.length, 0, 'entry was cleared once the build finished');
});

test('progress GET: failed status, userId ownership check, retry uses updated_at', async () => {
    projectRow = { id: 'pf', creator_id: 'u1', status: 'failed', created_at: new Date().toISOString(), updated_at: null };
    const f = await (await getProgress('pf')).json();
    assert.deepEqual([f.status, f.percent], ['failed', 0]); assert.ok(f.error);
    assert.equal((await getProgress('pf', '?userId=intruder')).status, 403);
    assert.equal((await getProgress('pf', '?userId=u1')).status, 200);

    const old = new Date(Date.now() - 3600e3).toISOString();
    projectRow = { id: 'pr', creator_id: 'u1', status: 'building', created_at: old, updated_at: new Date().toISOString() };
    const r = await (await getProgress('pr')).json();
    assert.equal(r.phase, 'generate', 'retry timeline restarts from updated_at, not the original created_at');
});

// ---------------- export-apk ----------------
test('export-apk: 400 without userId, 404 unknown, 403 for non-owner (worker never called)', async () => {
    let workerCalls = 0; external = () => { workerCalls++; return new Response('{}'); };
    projectRow = { id: 'pa', creator_id: 'owner', title: 'T', github_repo: null };
    assert.equal((await post('/pa/export-apk', {})).status, 400);
    assert.equal((await post('/nope/export-apk', { userId: 'owner' })).status, 404);
    const r = await post('/pa/export-apk', { userId: 'intruder', bundle: 'AAAA' });
    assert.equal(r.status, 403); assert.deepEqual(await r.json(), { error: 'Not your project' });
    assert.equal(workerCalls, 0);
});

test('export-apk: owner with client bundle is forwarded to worker with the secret; worker failure -> 500', async () => {
    projectRow = { id: 'pa', creator_id: 'owner', title: 'My App', github_repo: null };
    let seen;
    external = (u, o) => { seen = { u, o }; return new Response(JSON.stringify({ success: true, apkSize: 5 })); };
    const r = await quiet(() => post('/pa/export-apk', { userId: 'owner', bundle: 'QUJD' }));
    assert.equal(r.status, 200); assert.equal((await r.json()).apkSize, 5);
    assert.equal(seen.u.href, 'http://worker.test:3456/build-apk');
    assert.equal(seen.o.headers['x-worker-secret'], 'test-worker-secret');
    assert.deepEqual(JSON.parse(seen.o.body), { projectId: 'pa', bundle: 'QUJD', appName: 'My App' });

    external = () => new Response(JSON.stringify({ error: 'gradle blew up' }), { status: 500 });
    const f = await quiet(() => post('/pa/export-apk', { userId: 'owner', bundle: 'QUJD' }));
    assert.equal(f.status, 500);
});

test('export-apk: the worker is told which https origin to serve the app from (published wins, preview next, none for foreign urls)', async () => {
    strictSelect = true;
    const send = async (extra) => {
        projectRow = { id: 'pa', creator_id: 'owner', title: 'My App', github_repo: null, ...extra };
        let body; external = (u, o) => { body = JSON.parse(o.body); return new Response(JSON.stringify({ success: true, apkSize: 5 })); };
        assert.equal((await quiet(() => post('/pa/export-apk', { userId: 'owner', bundle: 'QUJD' }))).status, 200); return body;
    };
    assert.equal((await send({ published_url: 'https://my-app.vibebuild.cc', preview_url: 'https://preview-abc123def456.vibebuild.cc' })).host, 'my-app.vibebuild.cc');
    assert.equal((await send({ published_url: null, preview_url: 'https://preview-abc123def456.vibebuild.cc' })).host, 'preview-abc123def456.vibebuild.cc');
    const none = await send({ published_url: 'https://evil.com', preview_url: null }); assert.equal('host' in none, false);
    assert.deepEqual(none, { projectId: 'pa', bundle: 'QUJD', appName: 'My App' });
    strictSelect = false;
});

test('export-apk: no bundle anywhere -> 400', async () => {
    projectRow = { id: 'pa', creator_id: 'owner', title: 'T', github_repo: null };
    external = () => new Response('{}');
    const r = await quiet(() => post('/pa/export-apk', { userId: 'owner' }));
    assert.equal(r.status, 400);
});
