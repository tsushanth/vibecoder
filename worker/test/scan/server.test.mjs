import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// End to end through the real server.js (direct generation, fake model provider): the scan sits between generation and delivery.
const j = (...p) => p.join('');
const KEY = j('AIza', 'SyA1234567890abcdefghijklmnopqrstuv');
const WORKER_DIR = fileURLToPath(new URL('../../', import.meta.url));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-scan-home-'));
const OUTCOMES = path.join(HOME, 'outcomes.jsonl');
const page = (js) => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title></head><body><!--${'x'.repeat(250)}--><button id="b">go</button><div id="out"></div><script>${js}</script></body></html>`;
const GOOD = page("document.getElementById('b').onclick=function(){document.getElementById('out').textContent='ok'};");
const OWN_XHR = page("var x = new XMLHttpRequest(); x.open('GET', 'https://preview-abcdef123456.vibebuild.cc/data.json'); x.send();");
const BAD = page(`var k = "${KEY}"; document.getElementById('b').onclick=function(){document.getElementById('out').textContent=k};`);

let provider, PPORT; const seen = [];
before(async () => {
    provider = http.createServer((req, res) => {
        let body = ''; req.on('data', (d) => { body += d; });
        req.on('end', () => {
            const j2 = JSON.parse(body);
            const all = JSON.stringify(j2.messages);
            const isFix = j2.messages.some((m) => m.role === 'user' && /Automated checks found/.test(m.content));
            seen.push({ system: j2.messages.find((m) => m.role === 'system')?.content || '', fixRequest: isFix ? j2.messages.at(-1).content : null });
            const html = /OWNXHR/.test(all) ? OWN_XHR : /SCANFIX/.test(all) && isFix ? GOOD : /SCAN(FIX|BAD)/.test(all) ? BAD : GOOD;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ choices: [{ message: { content: `<file path="index.html">\n${html}\n</file>` }, finish_reason: 'stop' }], usage: { cost: 0.001 } }));
        });
    });
    await new Promise((r) => provider.listen(0, r));
    PPORT = provider.address().port;
});
after(() => provider?.close());

function startWorker(env = {}) {
    return new Promise((resolve, reject) => {
        const port = 38000 + Math.floor(Math.random() * 2000);
        const child = spawn(process.execPath, ['server.js'], { cwd: WORKER_DIR, env: { PATH: path.dirname(process.execPath), HOME, WORKER_PORT: String(port), WORKER_SECRET: 'test-worker-secret-0123456789', OUTCOME_LOG: OUTCOMES, OPENROUTER_API_KEY: 'fake', OPENROUTER_BASE_URL: `http://127.0.0.1:${PPORT}`, DIRECT_PERCENT: '100', DIRECT_MODELS: 'm1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
        child.logs = () => out;
        const t = setTimeout(() => { child.kill(); reject(new Error('worker did not start: ' + out.slice(-300))); }, 15000);
        const iv = setInterval(async () => { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) { clearInterval(iv); clearTimeout(t); resolve({ child, base: `http://127.0.0.1:${port}` }); } } catch { /* not up yet */ } }, 150);
    });
}
async function generate(base, prompt, extra = {}) {
    const r = await fetch(base + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-secret': 'test-worker-secret-0123456789' }, body: JSON.stringify({ prompt, userId: 't', stream: true, ...extra }) });
    const text = await r.text(); let ev = null;
    for (const chunk of text.split('\n\n')) { const l = chunk.split('\n').find((x) => x.startsWith('data: ')); if (!l) continue; try { const p = JSON.parse(l.slice(6)); if (p.type === 'result' || p.type === 'error') ev = p; } catch { /* partial */ } }
    return { ev, raw: text };
}
const lastOutcome = () => { const lines = fs.readFileSync(OUTCOMES, 'utf8').trim().split('\n'); return JSON.parse(lines.at(-1)); };

test('a draft with a hardcoded key is sent to the fix pass without the value, and the corrected app is delivered', async () => {
    const w = await startWorker(); seen.length = 0;
    try {
        const { ev, raw } = await generate(w.base, 'SCANFIX a notes app');
        assert.equal(ev.type, 'result', JSON.stringify(ev).slice(0, 200));
        assert.equal(seen.length, 2);
        assert.match(seen[1].fixRequest, /hardcoded_secret in index\.html line \d+/);
        assert.equal(seen[1].fixRequest.includes(KEY), false, 'the value must not be sent back to the model');
        assert.equal(raw.includes(KEY), false);
        const o = lastOutcome(); assert.equal(o.result, 'ok'); assert.equal(o.fixes, 1);
    } finally { w.child.kill(); }
});

test('a draft that still has the key after the fix pass fails with a clear user-safe message and is recorded as scan_failed', async () => {
    const w = await startWorker(); seen.length = 0;
    try {
        const { ev, raw } = await generate(w.base, 'SCANBAD a notes app');
        assert.equal(ev.type, 'error', 'a bad app must not be delivered');
        assert.match(ev.error, /secret key or contact an outside service/);
        assert.match(ev.error, /try again/i);
        assert.equal(raw.includes(KEY), false);
        const o = lastOutcome(); assert.equal(o.result, 'scan_failed');
        assert.equal(JSON.stringify(o).includes(KEY), false, 'the outcome record must not carry the value');
        assert.equal(w.child.logs().includes(KEY), false, 'the worker log must not carry the value');
    } finally { w.child.kill(); }
});

test('a clean app is delivered with no extra model call', async () => {
    const w = await startWorker(); seen.length = 0;
    try {
        const { ev } = await generate(w.base, 'a plain counter app', { projectId: 'abcdef12-3456-7890-abcd-ef1234567890' });
        assert.equal(ev.type, 'result'); assert.equal(seen.length, 1);
        assert.equal(lastOutcome().result, 'ok');
    } finally { w.child.kill(); }
});

test('the generation prompt explains [SECRET:NAME] placeholders when the proxy is enabled', async () => {
    const w = await startWorker({ VIBE_PROXY_ENABLED: 'true' }); seen.length = 0;
    try {
        await generate(w.base, 'a map app using [SECRET:GOOGLE_API_KEY]');
        assert.match(seen[0].system, /\[SECRET:NAME\]/);
    } finally { w.child.kill(); }
});

test('the app\'s own preview domain is allowed only for the project the worker was told about', async () => {
    const w = await startWorker(); seen.length = 0;
    try {
        const mine = await generate(w.base, 'OWNXHR app', { projectId: 'abcdef12-3456-7890-abcd-ef1234567890' });
        assert.equal(mine.ev.type, 'result', JSON.stringify(mine.ev).slice(0, 200));
        assert.equal(seen.length, 1);
        seen.length = 0;
        const other = await generate(w.base, 'OWNXHR app', { projectId: 'ffffffff-3456-7890-abcd-ef1234567890' });
        assert.equal(other.ev.type, 'error', 'another project\'s domain must not be allowed');
        assert.equal(lastOutcome().result, 'scan_failed');
        assert.match(seen[1].fixRequest, /external_request/);
        const none = await generate(w.base, 'OWNXHR app');
        assert.equal(none.ev.type, 'error', 'no project id means only the proxy host is allowed');
    } finally { w.child.kill(); }
});
