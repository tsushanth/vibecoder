import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-failclosed-'));
const run = (env, ms = 12000) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: DIR, env: { PATH: path.dirname(process.execPath), HOME, OUTCOME_LOG: path.join(HOME, 'o.jsonl'), WORKER_PORT: String(39000 + Math.floor(Math.random() * 900)), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { child.kill(); resolve({ code: null, out, killed: true }); }, ms);
    child.on('exit', (code) => { clearTimeout(t); resolve({ code, out, killed: false }); });
});

test('the worker refuses to start without WORKER_SECRET and names it', async () => {
    const r = await run({});
    assert.equal(r.killed, false, 'it must exit, not keep running unprotected');
    assert.notEqual(r.code, 0); assert.match(r.out, /WORKER_SECRET/);
});

test('the worker refuses a too-short WORKER_SECRET without printing it', async () => {
    const r = await run({ WORKER_SECRET: 'tinysecret' });
    assert.notEqual(r.code, 0); assert.match(r.out, /WORKER_SECRET/); assert.equal(r.out.includes('tinysecret'), false);
});

test('the worker starts normally with a good WORKER_SECRET', async () => {
    const env = { WORKER_SECRET: 'unit-test-worker-secret-0123456789' };
    const port = 39900 + Math.floor(Math.random() * 90);
    const child = spawn(process.execPath, ['server.js'], { cwd: DIR, env: { PATH: path.dirname(process.execPath), HOME, OUTCOME_LOG: path.join(HOME, 'o.jsonl'), WORKER_PORT: String(port), ...env }, stdio: 'ignore' });
    try {
        let ok = false;
        for (let i = 0; i < 60 && !ok; i++) { try { ok = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 200)); } }
        assert.equal(ok, true);
        const bad = await fetch(`http://127.0.0.1:${port}/ready`, { headers: { 'x-worker-secret': 'wrong-secret-value-0123456789' } });
        assert.equal(bad.status, 401);
    } finally { child.kill(); }
});

test('no built-in secret default remains in the worker source', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('git', ['grep', '-nE', "WORKER_SECRET[^|\\n]*\\|\\|[[:space:]]*['\\\"]", '--', 'server.js', 'lib', 'brokerReady.js', 'scripts'], { cwd: DIR, encoding: 'utf8' });
    assert.equal(r.stdout.trim(), '');
});
