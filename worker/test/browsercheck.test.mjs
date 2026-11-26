import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeProblems } from '../lib/browsercheck.js';

const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
let hasPuppeteer = true;
try { await import('puppeteer-core'); } catch { hasPuppeteer = false; }
const real = (n, f) => test(n, { skip: CHROME && hasPuppeteer ? false : 'needs Chrome and puppeteer-core installed (otherwise the check fails open and proves nothing)' }, f);

const page = (body) => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;
// every probe reports through a thrown error, which is what the check returns
// the check only watches the page for about 400 ms after load, so report well inside that
const report = (expr, ms = 200) => `setTimeout(function(){ throw new Error('PROBE ' + (${expr})); }, ${ms});`;
const run = (files) => runtimeProblems(files, { chrome: CHROME });

real('the checked app is isolated: files outside the app are not available to it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-mark-'));
    try {
        const text = path.join(dir, 'outside.txt'); fs.writeFileSync(text, 'MARK-XHR');
        const script = path.join(dir, 'outside.js'); fs.writeFileSync(script, 'window.OUT="MARK-SCRIPT"');
        const u = JSON.stringify(pathToFileURL(text).href);
        const problems = await run({ 'index.html': page(`<script src="${pathToFileURL(script).href}"></script><iframe id="f" src="${pathToFileURL(text).href}"></iframe><script>
            var got = [String(window.OUT)];
            try { var x = new XMLHttpRequest(); x.open('GET', ${u}, false); x.send(); got.push(x.responseText); } catch (e) { got.push('xhr-refused'); }
            fetch(${u}).then(function(r){ return r.text(); }).then(function(t){ got.push(t); }).catch(function(){ got.push('fetch-refused'); });
            setTimeout(function(){ try { got.push(document.getElementById('f').contentDocument.body.innerText); } catch (e) { got.push('frame-refused'); } }, 100);
            ${report("got.join('|')")}</script>`) });
        const all = problems.join('\n');
        assert.match(all, /PROBE/, 'the probe ran');
        assert.doesNotMatch(all, /MARK/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

real('the checked app is isolated: its requests do not leave the browser', async () => {
    let connections = 0;
    const srv = net.createServer((s) => { connections += 1; s.destroy(); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
        const at = `127.0.0.1:${srv.address().port}`;
        const problems = await run({ 'index.html': page(`<script>
            fetch('http://${at}/a').catch(function(){}); new Image().src = 'http://${at}/b';
            try { new WebSocket('ws://${at}/c'); } catch (e) {}
            try { window.open('http://${at}/d'); } catch (e) {}
            navigator.sendBeacon('http://localhost:${srv.address().port}/e', 'x');
            var l = document.createElement('link'); l.rel = 'preconnect'; l.href = 'http://${at}'; document.head.appendChild(l);
            var w = new Worker(URL.createObjectURL(new Blob(["fetch('http://${at}/f').catch(function(){})"])));
            ${report("'done'")}</script>`) });
        assert.match(problems.join('\n'), /PROBE done/);
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(connections, 0);
    } finally { srv.close(); }
});

real('the app loads its own scripts and modules, and their errors are reported', async () => {
    const problems = await run({
        'index.html': page('<script src="js/classic.js"></script><script type="module" src="./main.js"></script>'),
        'js/classic.js': 'window.fromClassic = "classic";',
        'main.js': 'import { v } from "./js/mod.js"; localStorage.setItem("k", v); setTimeout(() => { throw new Error("PROBE " + window.fromClassic + " " + localStorage.getItem("k")); }, 100);',
        'js/mod.js': 'export const v = "module";',
    });
    assert.match(problems.join('\n'), /PROBE classic module/);
});
