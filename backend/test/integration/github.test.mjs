import './../helpers/env.mjs';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { stubSupabase, eqOf } from '../helpers/supabaseStub.mjs';
const { supabase } = await import('../../config/database.js');
const gh = await import('../../routes/github.routes.js');

let srv, ghHandler, outbound;
const realFetch = globalThis.fetch;
const jres = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

before(async () => {
    // Only external (non-loopback) requests are intercepted.
    globalThis.fetch = (url, opts = {}) => {
        const u = new URL(String(url));
        if (u.hostname === '127.0.0.1') return realFetch(url, opts);
        outbound.push({ url: String(url), opts });
        return ghHandler(u, opts);
    };
    const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use('/api/github', gh.default);
    srv = await listen(app);
});
after(async () => { globalThis.fetch = realFetch; await srv.close(); });
beforeEach(() => { outbound = []; ghHandler = () => { throw new Error('unexpected outbound call'); }; });

// Each call gets its own client IP (via X-Forwarded-For) so the per-IP hourly limiters don't interfere, except where a test pins one.
let ipN = 0;
const post = (path, body, ip = `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`) => realFetch(`${srv.base}/api/github${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) });
const quiet = async (fn) => { const e = console.error, l = console.log; console.error = console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };

function fakeRepo({ meta = {}, tree, files = {}, treeStatus = 200 } = {}) {
    const entries = tree || Object.entries(files).map(([path, c]) => ({ path, type: 'blob', size: Buffer.byteLength(c) }));
    return (u) => {
        if (u.origin === 'https://api.github.com' && /^\/repos\/[^/]+\/[^/]+$/.test(u.pathname))
            return jres(meta.status || 200, { name: 'hello', description: 'A demo', private: false, size: 10, default_branch: 'main', ...meta.body });
        if (u.pathname.includes('/git/trees/')) return treeStatus === 200 ? jres(200, { truncated: false, tree: entries }) : jres(treeStatus, {});
        if (u.origin === 'https://raw.githubusercontent.com') {
            const rel = decodeURIComponent(u.pathname).split('/').slice(4).join('/');
            return files[rel] !== undefined ? new Response(files[rel]) : new Response('nf', { status: 404 });
        }
        throw new Error('unexpected ' + u);
    };
}

test('import: invalid url / ref / non-object body -> 400, no outbound calls', async () => {
    for (const body of [{}, { url: 'https://evil.com/o/r' }, { url: 'https://github.com.evil.com/o/r' }, { url: 'https://github.com/o' }]) {
        assert.equal((await post('/import', body)).status, 400);
    }
    assert.equal((await post('/import', { url: 'https://github.com/o/r', ref: '../x' })).status, 400);
    assert.equal((await post('/import', { url: 'https://github.com/o/r', ref: 5 })).status, 400);
    assert.equal(outbound.length, 0);
});

test('import: happy path builds a valid bundle, skips unsafe files, only contacts GitHub, sends no credentials', async () => {
    ghHandler = fakeRepo({ files: {
        'index.html': '<h1>hi</h1>', 'js/app.js': 'console.log(1)', 'run.sh': 'rm -rf /', '.env': 'SECRET=1',
    }, tree: [
        { path: 'index.html', type: 'blob', size: 11 }, { path: 'js/app.js', type: 'blob', size: 14 },
        { path: 'run.sh', type: 'blob', size: 8 }, { path: '.env', type: 'blob', size: 8 },
        { path: '.github/workflows/x.yml', type: 'blob', size: 3 }, { path: 'js', type: 'tree' },
        { path: 'big.js', type: 'blob', size: gh.LIMITS.maxFileBytes + 1 },
    ] });
    const r = await post('/import', { url: 'https://github.com/octocat/hello/tree/dev' });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.ref, 'dev'); assert.equal(body.fileCount, 2); assert.equal(body.title, 'hello');
    assert.deepEqual(gh.readZip(body.bundle).map((f) => f.path).sort(), ['index.html', 'js/app.js']);
    assert.ok(body.skipped.some((s) => s.path === 'big.js' && s.reason === 'file_too_large'));
    assert.ok(body.skipped.length >= 4);
    for (const o of outbound) {
        assert.ok(['https://api.github.com', 'https://raw.githubusercontent.com'].includes(new URL(o.url).origin), o.url);
        assert.equal(o.opts.redirect, 'error');
        assert.equal(o.opts.headers.Authorization, undefined);
    }
});

test('import: uses default branch when no ref', async () => {
    ghHandler = fakeRepo({ meta: { body: { default_branch: 'trunk' } }, files: { 'index.html': 'x' } });
    const b = await (await post('/import', { url: 'https://github.com/o/r' })).json();
    assert.equal(b.ref, 'trunk');
});

test('import: upstream statuses map correctly', async () => {
    ghHandler = fakeRepo({ meta: { status: 404 } });
    assert.equal((await post('/import', { url: 'https://github.com/o/r' })).status, 404);
    ghHandler = fakeRepo({ meta: { status: 403 } });
    assert.equal((await post('/import', { url: 'https://github.com/o/r' })).status, 429);
    ghHandler = fakeRepo({ meta: { status: 500 } });
    assert.equal((await post('/import', { url: 'https://github.com/o/r' })).status, 502);
    ghHandler = fakeRepo({ meta: { body: { private: true } } });
    assert.equal((await post('/import', { url: 'https://github.com/o/r' })).status, 403);
    ghHandler = fakeRepo({ meta: { body: { size: 60 * 1024 } } });
    assert.equal((await post('/import', { url: 'https://github.com/o/r' })).status, 413);
    ghHandler = fakeRepo({ treeStatus: 404, files: {} });
    assert.equal((await post('/import', { url: 'https://github.com/o/r', ref: 'nope' })).status, 404);
});

test('import: content rules (no importable files, no root index.html, truncated tree)', async () => {
    ghHandler = fakeRepo({ files: { 'run.sh': 'x' } });
    assert.equal((await post('/import', { url: 'https://github.com/o/r' })).status, 422);
    ghHandler = fakeRepo({ files: { 'sub/index.html': 'x' } });
    const r = await post('/import', { url: 'https://github.com/o/r' });
    assert.equal(r.status, 422); assert.match((await r.json()).error, /index\.html/);
    ghHandler = (u) => u.pathname.includes('/git/trees/') ? jres(200, { truncated: true, tree: [] }) : fakeRepo({})(u);
    assert.equal((await post('/import', { url: 'https://github.com/o/r' })).status, 413);
});

test('import: fetch failure -> 500 with generic message; timeout -> 504', async () => {
    ghHandler = () => { throw new Error('secret internal detail'); };
    let r = await quiet(() => post('/import', { url: 'https://github.com/o/r' }));
    assert.equal(r.status, 500); assert.deepEqual(await r.json(), { error: 'Import failed' });
    ghHandler = () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
    r = await quiet(() => post('/import', { url: 'https://github.com/o/r' }));
    assert.equal(r.status, 504);
});

const TOKEN = 'github_pat_' + 'A1b2'.repeat(10);
const goodExport = { projectId: 'p1', userId: 'u1', token: TOKEN, owner: 'octocat', repo: 'hello' };

function projectDb(row) {
    return stubSupabase(supabase, (q) => q.table === 'projects' && eqOf(q, 'id') === 'p1' ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } });
}

test('export: validation 400s never reach GitHub and never echo the token', async () => {
    for (const bad of [
        { ...goodExport, projectId: undefined }, { ...goodExport, userId: '' }, { ...goodExport, token: 'short' },
        { ...goodExport, token: undefined }, { ...goodExport, owner: 'a--b' }, { ...goodExport, repo: '..' }, { ...goodExport, branch: '../x' },
    ]) {
        const r = await post('/export', bad); const t = await r.text();
        assert.equal(r.status, 400, JSON.stringify(bad)); assert.ok(!t.includes(TOKEN));
    }
    assert.equal(outbound.length, 0);
});

test('export: unknown project 404, someone else\'s project 403 (no GitHub call)', async () => {
    let restore = projectDb(null);
    try { assert.equal((await post('/export', goodExport)).status, 404); } finally { restore(); }
    restore = projectDb({ id: 'p1', creator_id: 'someone-else', bundle: 'x' });
    try { assert.equal((await post('/export', goodExport)).status, 403); } finally { restore(); }
    assert.equal(outbound.length, 0);
});

test('export: happy path pushes with token only to api.github.com; token absent from response and logs', async () => {
    const bundle = gh.buildZip([{ path: 'index.html', data: Buffer.from('<h1>x</h1>') }, { path: '.env', data: Buffer.from('S=1') }]).toString('base64');
    const restore = projectDb({ id: 'p1', creator_id: 'u1', github_repo: null, bundle });
    ghHandler = (u, o) => {
        const p = u.pathname, m = o.method || 'GET';
        if (p === '/repos/octocat/hello') return jres(200, { default_branch: 'main', permissions: { push: true } });
        if (p.endsWith('/git/ref/heads/main')) return jres(200, { object: { sha: 'parent1' } });
        if (p.endsWith('/git/commits/parent1')) return jres(200, { tree: { sha: 'tree0' } });
        if (p.endsWith('/git/blobs')) return jres(201, { sha: 'blob1' });
        if (p.endsWith('/git/trees') && m === 'POST') return jres(201, { sha: 'tree1' });
        if (p.endsWith('/git/commits') && m === 'POST') return jres(201, { sha: 'commit1' });
        if (p.endsWith('/git/refs/heads/main') && m === 'PATCH') return jres(200, {});
        throw new Error('unexpected ' + m + ' ' + u);
    };
    const logs = []; const ol = console.log, oe = console.error;
    console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => logs.push(a.join(' '));
    let r, text;
    try { r = await post('/export', goodExport); text = await r.text(); } finally { console.log = ol; console.error = oe; restore(); }
    assert.equal(r.status, 200, text);
    const body = JSON.parse(text);
    assert.deepEqual([body.success, body.branch, body.commitSha, body.fileCount], [true, 'main', 'commit1', 1]); // .env dropped by safePath
    assert.ok(!text.includes(TOKEN)); assert.ok(!logs.join('\n').includes(TOKEN));
    for (const o of outbound) {
        assert.equal(new URL(o.url).origin, 'https://api.github.com');
        assert.equal(o.opts.headers.Authorization, `Bearer ${TOKEN}`);
        assert.equal(o.opts.redirect, 'error');
    }
    const ref = outbound.find((o) => o.opts.method === 'PATCH');
    assert.deepEqual(JSON.parse(ref.opts.body), { sha: 'commit1', force: false }, 'never force-pushes');
});

test('export: GitHub rejections map to 401 / 403 / 409', async () => {
    const restore = projectDb({ id: 'p1', creator_id: 'u1', github_repo: null, bundle: gh.buildZip([{ path: 'index.html', data: Buffer.from('x') }]).toString('base64') });
    try {
        ghHandler = () => jres(401, {}); assert.equal((await post('/export', goodExport)).status, 401);
        ghHandler = () => jres(404, {}); assert.equal((await post('/export', goodExport)).status, 403);
        ghHandler = () => jres(200, { default_branch: 'main', permissions: { push: false } }); assert.equal((await post('/export', goodExport)).status, 403);
        ghHandler = (u) => u.pathname === '/repos/octocat/hello' ? jres(200, { default_branch: 'main' }) : jres(404, {});
        assert.equal((await post('/export', goodExport)).status, 409, 'empty repo');
    } finally { restore(); }
});

test('rate limits: import 20/h and export 10/h per IP -> 429', async () => {
    for (let i = 0; i < 20; i++) assert.equal((await post('/import', {}, '9.9.9.9')).status, 400);
    const r = await post('/import', {}, '9.9.9.9');
    assert.equal(r.status, 429); assert.match((await r.json()).error, /Too many imports/);
    for (let i = 0; i < 10; i++) assert.equal((await post('/export', {}, '8.8.8.8')).status, 400);
    assert.equal((await post('/export', {}, '8.8.8.8')).status, 429);
    assert.equal(outbound.length, 0);
});
