import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cliBuildsEnabled, cliSpawnOptions } from '../lib/cli.js';
import { checkBrokerReady } from '../brokerReady.js';

const WORKER_DIR = fileURLToPath(new URL('../', import.meta.url));
const SECRET = ['test', 'worker', 'secret', '0123456789'].join('-');

test('CLI builds are off unless the flag is exactly "true"', () => {
    for (const v of [undefined, '', '1', 'TRUE', 'yes', 'false']) assert.equal(cliBuildsEnabled({ CLAUDE_CLI_BUILDS_ENABLED: v }), false, String(v));
    assert.equal(cliBuildsEnabled({ CLAUDE_CLI_BUILDS_ENABLED: 'true' }), true);
});

test('spawn options: file tools only, no external tool servers, permission checks on, minimal environment', () => {
    const { args, env } = cliSpawnOptions({ prompt: 'P', maxTurns: 3, home: '/h', env: { PATH: '/p', WORKER_SECRET: 's', GITHUB_PAT: 'g', OPENROUTER_API_KEY: 'o', APK_KEYSTORE_PASSWORD: 'k', ANTHROPIC_API_KEY: 'a', ENABLE_CLAUDEAI_MCP_SERVERS: 'true' } });
    const after = (flag) => args[args.indexOf(flag) + 1];
    assert.equal(after('--tools'), 'Read,Write,Edit,Glob,Grep');
    assert.equal(after('--permission-mode'), 'acceptEdits');
    assert.equal(after('--setting-sources'), 'user');
    assert.ok(args.includes('--strict-mcp-config'));
    assert.deepEqual(JSON.parse(after('--mcp-config')), { mcpServers: {} });
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    assert.deepEqual(args.slice(-2), ['--', 'P']);
    assert.deepEqual(Object.keys(env).sort(), ['ENABLE_CLAUDEAI_MCP_SERVERS', 'HOME', 'PATH']);
    assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
});

test('the default broker address is this machine', async () => {
    let url;
    await checkBrokerReady({ readSecret: () => 'abc', fetchImpl: async (u) => { url = u; return new Response('{}', { status: 200 }); } });
    assert.equal(url, 'http://127.0.0.1:3460/token');
});

// A real worker process with every build routed to the CLI, and a stand-in `claude-multi` that records how it was called.
async function withWorker(extraEnv, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-cli-'));
    const record = path.join(dir, 'called.json');
    fs.writeFileSync(path.join(dir, 'claude-multi'), `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), env: Object.keys(process.env) }));\n`, { mode: 0o755 });
    const port = 38000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['server.js'], { cwd: WORKER_DIR, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: `${dir}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, FAILURE_REPORTER_DISABLED: '1', NODE_ENV: 'test', WORKER_PORT: String(port), WORKER_SECRET: SECRET, OUTCOME_LOG: path.join(dir, 'outcomes.jsonl'), DIRECT_PERCENT: '0', CLAUDE_BROKER_SECRET_FILE: path.join(dir, 'none'), ...extraEnv } });
    let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
    const base = `http://127.0.0.1:${port}`;
    try {
        for (let i = 0; ; i++) {
            try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ }
            if (i > 100) throw new Error('worker did not start: ' + log.slice(-400));
            await new Promise((r) => setTimeout(r, 150));
        }
        const r = await fetch(`${base}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-secret': SECRET }, body: JSON.stringify({ prompt: 'a timer', userId: 't', stream: true }) });
        const stream = await r.text();
        const ready = await fetch(`${base}/ready`, { headers: { 'x-worker-secret': SECRET } });
        await fn({ stream, record, ready: await ready.json(), log: () => log });
    } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('worker, flag unset: a build routed to the CLI fails and starts no CLI process', async () => {
    await withWorker({}, ({ stream, record, ready, log }) => {
        assert.match(stream, /"type":"error"/);
        assert.equal(fs.existsSync(record), false, 'the CLI must not run');
        assert.match(log(), /CLI build path disabled: no CLI process started/);
        assert.deepEqual(ready, { ready: false, mode: 'broker', reason: 'CLI build path disabled' });
    });
});

test('worker, flag on: the CLI runs with the restricted arguments and without worker secrets', async () => {
    await withWorker({ CLAUDE_CLI_BUILDS_ENABLED: 'true', GITHUB_PAT: 'x' }, ({ record }) => {
        const call = JSON.parse(fs.readFileSync(record, 'utf8'));
        assert.ok(call.args.includes('--strict-mcp-config') && !call.args.includes('--dangerously-skip-permissions'));
        assert.ok(call.env.includes('ENABLE_CLAUDEAI_MCP_SERVERS'));
        for (const k of ['WORKER_SECRET', 'GITHUB_PAT']) assert.ok(!call.env.includes(k), k);
    });
});
