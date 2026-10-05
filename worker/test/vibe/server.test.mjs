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

const keyedJs = 'function ask(){ vibe.api("stocks","/v1/quote").then(function(t){ out.textContent = JSON.stringify(t); }).catch(function(e){ out.textContent = "unavailable (" + e.code + ")"; }); }';
const KEYED_MANIFEST = JSON.stringify({ connectors: { stocks: { host: 'API.Example.com', paths: ['/v1/quote*'], methods: ['GET'], note: 'dropped', secret: { name: 'STOCKS_API_KEY', in: 'query', field: 'apikey' } } } });
const KEYED_NORMALISED = `${JSON.stringify({ connectors: { stocks: { host: 'api.example.com', paths: ['/v1/quote*'], methods: ['GET'], secret: { name: 'STOCKS_API_KEY', in: 'query', field: 'apikey' } } } }, null, 2)}\n`;

const dataJs = (table) => `vibe.auth.ready.then(function(){ return vibe.auth.user(); }).then(function(u){ if (!u) return; vibe.db.from("${table}").select().then(function(r){ out.textContent = r.length; }).catch(function(e){ out.textContent = e.code; }); });`;
const DATA_SCHEMA = JSON.stringify({ version: 1, tables: { todos: { columns: { title: { type: 'text', required: true } } } } });
const DATA_NORMALISED = `${JSON.stringify({ version: 1, tables: { todos: { access: 'owner', columns: { title: { type: 'text', required: true } }, indexes: [] } } }, null, 2)}\n`;

let provider, PPORT; const calls = [];
before(async () => {
    provider = http.createServer((req, res) => {
        let body = ''; req.on('data', (d) => { body += d; });
        req.on('end', () => {
            const j = JSON.parse(body);
            calls.push({ system: j.messages.find((m) => m.role === 'system')?.content || '', n: j.messages.length, last: j.messages[j.messages.length - 1].content });
            if (/DATAAPP/.test(JSON.stringify(j.messages))) {
                // first reply reads a table the schema does not declare (the table name is the only thing the fix text may echo); the fix pass corrects it
                const fixed = j.messages.length > 2;
                const reply = `<file path="index.html">\n${app(dataJs(fixed ? 'todos' : 'tasks'))}\n</file>\n<file path="vibe.schema.json">\n${DATA_SCHEMA}\n</file>`;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage: { cost: 0.001 } }));
            }
            const keyed = /KEYEDAPP/.test(JSON.stringify(j.messages));
            const mode = keyed || /VIBEAPP/.test(JSON.stringify(j.messages)) ? 'vibe' : 'plain';
            const html = keyed ? app(keyedJs) : mode === 'vibe' ? app(guarded) : app('function ask(){}', '');
            const evil = keyed ? `\n<file path="vibe.manifest.json">\n${KEYED_MANIFEST}\n</file>` : mode === 'vibe' ? '\n<file path="vibe.js">\nwindow.vibe={steal:function(){}}\n</file>' : '';
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
        const child = spawn(process.execPath, ['server.js'], { cwd: WORKER_DIR, env: { PATH: path.dirname(process.execPath), HOME, WORKER_PORT: String(port), WORKER_SECRET: 'test-worker-secret-0123456789', OUTCOME_LOG: path.join(HOME, 'outcomes.jsonl'), OPENROUTER_API_KEY: 'fake', OPENROUTER_BASE_URL: `http://127.0.0.1:${PPORT}`, DIRECT_PERCENT: '100', DIRECT_MODELS: 'm1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
        const t = setTimeout(() => { child.kill(); reject(new Error('worker did not start: ' + out.slice(-300))); }, 15000);
        const iv = setInterval(async () => { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) { clearInterval(iv); clearTimeout(t); resolve({ child, base: `http://127.0.0.1:${port}` }); } } catch { /* not up yet */ } }, 150);
    });
}
async function generate(base, prompt) {
    const r = await fetch(base + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-secret': 'test-worker-secret-0123456789' }, body: JSON.stringify({ prompt, userId: 't', stream: true }) });
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

test('proxy enabled: a keyed connector app ships the normalised vibe.manifest.json next to the real vibe.js', async () => {
    const w = await startWorker({ VIBE_PROXY_ENABLED: 'true' });
    try {
        calls.length = 0;
        const ev = await generate(w.base, 'KEYEDAPP stock quotes');
        assert.equal(ev.type, 'result', JSON.stringify(ev).slice(0, 300));
        assert.ok(names(ev).includes('vibe.manifest.json') && names(ev).includes('vibe.js'), names(ev).join(','));
        assert.equal(ev.files.find((f) => f.path === 'vibe.manifest.json').size, Buffer.byteLength(KEYED_NORMALISED), 'the delivered manifest must be the normalised one');
        assert.ok(calls[0].system.includes('vibe.manifest.json'), 'the prompt teaches the manifest');
        assert.equal(calls.length, 1, 'a valid manifest needs no fix pass');
    } finally { w.child.kill(); }
});

test('proxy enabled: a table the schema does not declare goes through the fix pass, then the app ships with the normalised schema', async () => {
    const w = await startWorker({ VIBE_PROXY_ENABLED: 'true' });
    try {
        calls.length = 0;
        const ev = await generate(w.base, 'DATAAPP a todo list with accounts');
        assert.equal(ev.type, 'result', JSON.stringify(ev).slice(0, 300));
        assert.equal(calls.length, 2, 'one fix pass');
        assert.ok(calls[0].system.includes('vibe.schema.json') && calls[0].system.includes('vibe.db.from('), 'the prompt teaches tables');
        assert.match(calls[1].last, /"tasks"/); assert.match(calls[1].last, /not declared in vibe\.schema\.json/);
        assert.ok(names(ev).includes('vibe.schema.json') && names(ev).includes('vibe.js'), names(ev).join(','));
        assert.equal(ev.files.find((f) => f.path === 'vibe.schema.json').size, Buffer.byteLength(DATA_NORMALISED), 'the delivered schema must be the normalised one');
    } finally { w.child.kill(); }
});

test('proxy not enabled: an app with accounts and tables is never delivered', async () => {
    const w = await startWorker({});
    try {
        calls.length = 0;
        const ev = await generate(w.base, 'DATAAPP a todo list with accounts');
        assert.equal(ev.type, 'error');
        assert.equal(calls.some((c) => c.system.includes('vibe.schema.json')), false, 'the prompt must not teach tables while the proxy is off');
    } finally { w.child.kill(); }
});

test('proxy not enabled: a manifest is never delivered, and the build fails rather than ship an app that needs it', async () => {
    const w = await startWorker({ VIBE_PROXY_ENABLED: 'false' });
    try {
        const ev = await generate(w.base, 'KEYEDAPP stock quotes');
        assert.equal(ev.type, 'error');
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
