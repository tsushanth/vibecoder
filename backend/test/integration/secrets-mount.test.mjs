import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PID = '11111111-2222-3333-4444-555555555555';
// built at run time so no key-shaped literal sits in the source
const SPAWN_WORKER_SECRET = ['mount', 'test', 'worker', 'value', '0123456789'].join('-');
const SPAWN_INTERNAL_SECRET = ['mount', 'test', 'internal', 'value', '0123456789'].join('-');
let child, base, out = '';

before(async () => {
    const port = 38000 + Math.floor(Math.random() * 1500);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.js'], { cwd: DIR, env: { PATH: path.dirname(process.execPath), PORT: String(port), SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'test-anon-key', WORKER_SECRET: SPAWN_WORKER_SECRET, INTERNAL_SECRET: SPAWN_INTERNAL_SECRET, WORKER_URL: 'http://worker.test:3456', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    const end = Date.now() + 15000;
    for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up yet */ } if (Date.now() > end) throw new Error('server did not start: ' + out.slice(-300)); await new Promise((r) => setTimeout(r, 150)); }
});
after(() => child?.kill());

test('the secrets routes are mounted: unauthenticated requests are 401, not 404', async () => {
    for (const [m, p] of [['GET', `/api/projects/${PID}/secrets`], ['PUT', `/api/projects/${PID}/secrets/API_KEY`], ['DELETE', `/api/projects/${PID}/secrets/API_KEY`]]) {
        const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'PUT' ? JSON.stringify({ value: 'x'.repeat(10) }) : undefined });
        assert.equal(r.status, 401, `${m} ${p}`);
    }
});

test('the usage route is mounted: unauthenticated requests are 401, not 404', async () => {
    assert.equal((await fetch(`${base}/api/projects/${PID}/usage`)).status, 401);
    assert.equal((await fetch(`${base}/api/projects/${PID}/usage?days=7`, { headers: { authorization: 'Bearer not.a.real.token' } })).status, 401);
});

test('a token Supabase cannot verify is 401', async () => {
    const r = await fetch(`${base}/api/projects/${PID}/secrets`, { headers: { authorization: 'Bearer not.a.real.token' } });
    assert.equal(r.status, 401);
});

test('the legacy userId in the body or query is not accepted as identity', async () => {
    const r = await fetch(`${base}/api/projects/${PID}/secrets?userId=owner-1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'owner-1', value: 'x'.repeat(10) }) });
    assert.equal(r.status, 401);
});

test('web CORS: the VibeBuild web origins are allowed, other origins are not', async () => {
    const pre = (origin) => fetch(`${base}/api/projects/${PID}/secrets/API_KEY`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } });
    assert.equal((await pre('https://vibebuild.cc')).headers.get('access-control-allow-origin'), 'https://vibebuild.cc');
    assert.equal((await pre('https://evil.example.com')).headers.get('access-control-allow-origin'), null);
});

test('the router sits before the global 50 MB json parser: a 51 MB unauthenticated body is 401, never parsed or limit-rejected by it', async () => {
    const r = await fetch(`${base}/api/projects/${PID}/secrets/API_KEY`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"value":"' + 'a'.repeat(51 * 1024 * 1024) + '"}' });
    assert.equal(r.status, 401);
});

test('the existing projects routes are unaffected', async () => {
    const r = await fetch(`${base}/api/projects/browse`);
    assert.notEqual(r.status, 404);
});
