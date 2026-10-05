import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fullChecks } from '../../lib/browsercheck.js';
import { FORMAT } from '../../lib/generate.js';
import { VIBE_RULES } from '../../lib/vibe.js';

const hasPuppeteer = await import('puppeteer-core').then(() => true, () => false);
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const page = (js, head = '<script src="vibe.js"></script>') => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">${head}</head><body><!--${'x'.repeat(250)}--><button id="b" onclick="ask()">Ask</button><div id="out"></div><script>${js}</script></body></html>`;
const guarded = 'function ask(){ vibe.ai.ask("hi").then(function(t){ document.getElementById("out").textContent = t; }).catch(function(e){ document.getElementById("out").textContent = "AI unavailable (" + e.code + ")"; }); }';
const unguarded = 'function ask(){ vibe.ai.ask("hi").then(function(t){ document.getElementById("out").textContent = t; }); }';

test('fullChecks with vibe enabled reports unknown connectors without needing a browser', async () => {
    const r = await fullChecks({ 'index.html': page('vibe.api("stocks","/q")') }, { vibe: true, chrome: undefined });
    assert.equal(r.ok, false); assert.ok(r.problems.some((p) => /stocks/.test(p)));
});

test('fullChecks with vibe disabled rejects an app that uses vibe', async () => {
    const r = await fullChecks({ 'index.html': page(guarded) }, { vibe: false, chrome: undefined });
    assert.equal(r.ok, false); assert.ok(r.problems.some((p) => /not available/.test(p)));
});

test('fullChecks with vibe enabled accepts a guarded vibe app when no browser is configured', async () => {
    const r = await fullChecks({ 'index.html': page(guarded) }, { vibe: true, chrome: undefined });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});

const real = (n, f) => test(n, { skip: CHROME && hasPuppeteer ? false : 'needs Chrome and puppeteer-core installed (otherwise the check fails open and proves nothing)' }, f);

real('the runtime check runs the app with the real SDK injected, so a guarded vibe app passes', async () => {
    const r = await fullChecks({ 'index.html': page(guarded) }, { vibe: true, chrome: CHROME });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});

real('an unguarded vibe call that fails at run time is reported to the fix pass', async () => {
    const r = await fullChecks({ 'index.html': page(unguarded) }, { vibe: true, chrome: CHROME });
    assert.equal(r.ok, false); assert.equal(r.problems.length, 1, JSON.stringify(r.problems));
    assert.match(r.problems[0], /runtime error/); assert.match(r.problems[0], /Catch errors from vibe\.api and vibe\.ai/);
});

real('an unrelated unhandled rejection is reported as itself, without the vibe hint', async () => {
    const js = guarded + 'function other(){ Promise.reject(new Error("NotAllowedError: play() failed")); } document.addEventListener("click", function(){ other(); });';
    const r = await fullChecks({ 'index.html': page(js) }, { vibe: true, chrome: CHROME });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /NotAllowedError/.test(p)), JSON.stringify(r.problems));
    assert.equal(r.problems.some((p) => /vibe SDK/.test(p) && /NotAllowedError/.test(p)), false);
});

test('the output format tells the model not to write vibe.js or vibedata.js', () => {
    assert.match(FORMAT, /vibe\.js/); assert.match(FORMAT, /vibedata\.js/);
});

test('the vibe rules state that they override the no-external-APIs rule for vibe calls only', () => {
    assert.match(VIBE_RULES, /overrides/i); assert.match(VIBE_RULES, /vibe\.api and vibe\.ai only|only for vibe/i);
});
