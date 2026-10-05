import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadVibeSdk } from '../../lib/vibe.js';

const names = (ev) => ev.files.map((f) => f.path);

const WORKER_DIR = fileURLToPath(new URL('../../', import.meta.url));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-vibe-home-'));
const app = (js, head = '<script src="vibe.js"></script>') => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${head}<title>t</title></head><body><!--${'x'.repeat(250)}--><button id="b" onclick="ask()">Ask</button><div id="out"></div><script>${js}</script></body></html>`;
const guarded = 'function ask(){ vibe.ai.ask("hi").then(function(t){ out.textContent = t; }).catch(function(e){ out.textContent = "AI unavailable (" + e.code + ")"; }); }';

let provider, PPORT; const calls = [];
before(async () => {
    provider = http.createServer((req, res) => {
        let body = ''; req.on('data', (d) => { body += d; });
        req.on('end', () => {
            const j = JSON.parse(body);
            calls.push({ system: j.messages.find((m) => m.role === 'system')?.content || '', n: j.messages.length });
            const mode = /VIBEAPP/.test(JSON.stringify(j.messages)) ? 'vibe' : 'plain';
            const html = mode === 'vibe' ? app(guarded) : app('function ask(){}', '');
            const evil = mode === 'vibe' ? '\n<file path="vibe.js">\nwindow.vibe={steal:function(){}}\n</file>' : '';
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ choices: [{ message: { content: `<file path="index.html">\n${html}\n</file>${evil}` }, finish_reason: 'stop' }], usage: { cost: 0.001 } }));
        });
    });
    await new Promise((r) => provider.listen(0, r));
    PPORT = provider.address().port;
});
after(() => provider?.close());

function startWorker(env) {
    return new Promise((resolve, reject) => {
        const port = 36000 + Math.floor(Math.random() * 2000);
        const child = spawn(process.execPath, ['server.js'], { cwd: WORKER_DIR, env: { PATH: path.dirname(process.execPath), HOME, WORKER_PORT: String(port), WORKER_SECRET: 'testsecret', OUTCOME_LOG: path.join(HOME, 'outcomes.jsonl'), OPENROUTER_API_KEY: 'fake', OPENROUTER_BASE_URL: `http://127.0.0.1:${PPORT}`, DIRECT_PERCENT: '100', DIRECT_MODELS: 'm1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
        const t = setTimeout(() => { child.kill(); reject(new Error('worker did not start: ' + out.slice(-300))); }, 15000);
        const iv = setInterval(async () => { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) { clearInterval(iv); clearTimeout(t); resolve({ child, base: `http://127.0.0.1:${port}` }); } } catch { /* not up yet */ } }, 150);
    });
}
async function generate(base, prompt) {
    const r = await fetch(base + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-secret': 'testsecret' }, body: JSON.stringify({ prompt, userId: 't', stream: true }) });
    const text = await r.text(); let ev = null;
    for (const chunk of text.split('\n\n')) { const l = chunk.split('\n').find((x) => x.startsWith('data: ')); if (!l) continue; try { const j = JSON.parse(l.slice(6)); if (j.type === 'result' || j.type === 'error') ev = j; } catch { /* partial */ } }
    return ev;
}

test('proxy enabled: health says so, the prompt teaches vibe, and the delivered app includes the real vibe.js', async () => {
    const w = await startWorker({ VIBE_PROXY_ENABLED: 'true' });
    try {
        const h = await (await fetch(w.base + '/health')).json();
        assert.equal(h.vibe?.enabled, true);
        calls.length = 0;
        const ev = await generate(w.base, 'VIBEAPP a bot you can ask questions');
        assert.equal(ev.type, 'result', JSON.stringify(ev).slice(0, 200));
        assert.ok(names(ev).includes('vibe.js') && names(ev).includes('index.html'), names(ev).join(','));
        assert.equal(ev.files.find((f) => f.path === 'vibe.js').size, Buffer.byteLength(loadVibeSdk()), 'delivered vibe.js must be the real SDK, not the model-written one');
        assert.ok(calls[0].system.includes('vibe.ai.ask('), 'the vibe rules must be in the system prompt');
    } finally { w.child.kill(); }
});

test('proxy not enabled (default): no vibe in the prompt, health says disabled, and an app that uses vibe is rejected', async () => {
    const w = await startWorker({});
    try {
        const h = await (await fetch(w.base + '/health')).json();
        assert.equal(h.vibe?.enabled, false);
        calls.length = 0;
        const ev = await generate(w.base, 'VIBEAPP a bot you can ask questions');
        assert.equal(ev.type, 'error', 'an app calling vibe must not be delivered while the proxy is off');
        assert.equal(calls.some((c) => c.system.includes('vibe.ai.ask(')), false);
        assert.equal(calls.length, 2, 'initial attempt plus one fix pass');
    } finally { w.child.kill(); }
});

test('proxy not enabled: an ordinary app is delivered without vibe.js', async () => {
    const w = await startWorker({ VIBE_PROXY_ENABLED: 'false' });
    try {
        const ev = await generate(w.base, 'a plain counter');
        assert.equal(ev.type, 'result'); assert.ok(names(ev).includes('index.html')); assert.equal(names(ev).includes('vibe.js'), false);
    } finally { w.child.kill(); }
});

test('VIBE_PROXY_ENABLED must be exactly "true" to turn the proxy on', async () => {
    for (const v of ['1', 'yes', 'TRUE ']) {
        const w = await startWorker({ VIBE_PROXY_ENABLED: v });
        try { assert.equal((await (await fetch(w.base + '/health')).json()).vibe?.enabled, false, v); } finally { w.child.kill(); }
    }
});

test('the tests never write outcome lines into the repository', () => {
    assert.equal(fs.existsSync(path.join(WORKER_DIR, 'outcomes.jsonl')), false);
});
