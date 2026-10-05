import test from 'node:test';
import assert from 'node:assert/strict';
import { scanGenerated, allowedHostsFor, PROXY_HOST, userMessageForCause } from '../../lib/scan.js';
import { generateApp, BUILD_RULES } from '../../lib/generate.js';
import { makeOutcomeLogger, RESULTS } from '../../lib/outcome.js';
import { VIBE_RULES } from '../../lib/vibe.js';

const j = (...p) => p.join('');
const KEY = j('AIza', 'SyA1234567890abcdefghijklmnopqrstuv'); // built from fragments so no real-looking key sits in the repo
const PID = 'abcdef12-3456-7890-abcd-ef1234567890';
const page = (js) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title></head><body><button id="b">go</button><div id="out">${'x'.repeat(120)}</div><script>${js}</script></body></html>`;
const GOOD = page("document.getElementById('b').onclick=()=>{document.getElementById('out').textContent='ok'}");
const WITH_KEY = page(`var k = "${KEY}"; document.getElementById('b').onclick=()=>{document.getElementById('out').textContent=k}`);
const WITH_EXTERNAL = page("fetch('https://api.example.com/data').then(function(r){return r.json()}).then(function(d){document.getElementById('out').textContent=d.x})");
const block = (p, c) => `<file path="${p}">\n${c}\n</file>`;

// ---------- scanGenerated
test('a clean app passes the scan', () => {
    const r = scanGenerated({ 'index.html': GOOD }, { allowedHosts: [PROXY_HOST] });
    assert.equal(r.ok, true); assert.deepEqual(r.problems, []);
});

test('a hardcoded key is reported by kind, file and line, and the value never appears in the report', () => {
    const r = scanGenerated({ 'index.html': WITH_KEY }, { allowedHosts: [PROXY_HOST] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.findings.map((f) => [f.kind, f.file]), [['hardcoded_secret', 'index.html']]);
    assert.equal(typeof r.findings[0].line, 'number');
    assert.match(r.problems[0], /hardcoded_secret/); assert.match(r.problems[0], /index\.html/); assert.match(r.problems[0], new RegExp(`line ${r.findings[0].line}\\b`));
    assert.equal(JSON.stringify(r).includes(KEY), false);
    assert.equal(JSON.stringify(r).includes(KEY.slice(0, 12)), false, 'not even a prefix of the value');
});

test('an external request is reported and its target host is not echoed as a value-bearing detail', () => {
    const r = scanGenerated({ 'index.html': WITH_EXTERNAL }, { allowedHosts: [PROXY_HOST] });
    assert.equal(r.ok, false);
    assert.equal(r.findings[0].kind, 'external_request');
    assert.deepEqual(Object.keys(r.findings[0]).sort(), ['file', 'kind', 'line']);
});

test('the proxy host and the app\'s own preview domains are allowed, other hosts are not', () => {
    const hosts = allowedHostsFor(PID);
    assert.ok(hosts.includes(PROXY_HOST)); assert.equal(PROXY_HOST, 'vibe-proxy.vibebuild.cc');
    assert.ok(hosts.includes('preview-abcdef123456.vibebuild.cc')); assert.ok(hosts.includes('prev-abcdef12.vibebuild.cc'));
    const ok = scanGenerated({ 'index.html': page("fetch('https://vibe-proxy.vibebuild.cc/x/api')") }, { allowedHosts: hosts });
    assert.equal(ok.ok, true, JSON.stringify(ok.problems));
    const own = scanGenerated({ 'index.html': page("fetch('https://preview-abcdef123456.vibebuild.cc/data.json')") }, { allowedHosts: hosts });
    assert.equal(own.ok, true);
    const other = scanGenerated({ 'index.html': page("fetch('https://preview-ffffffffffff.vibebuild.cc/data.json')") }, { allowedHosts: hosts });
    assert.equal(other.ok, false);
});

test('allowedHostsFor without a usable project id allows only the proxy host', () => {
    for (const bad of [undefined, null, '', 'x', 'NOT A UUID', '../../etc']) assert.deepEqual(allowedHostsFor(bad), [PROXY_HOST], String(bad));
});

test('the platform-provided vibe.js and vibedata.js are not scanned (only generated code is)', () => {
    const sdk = "fetch('https://vibe-proxy.vibebuild.cc/x'); fetch('https://other.example.com/y')";
    const r = scanGenerated({ 'index.html': GOOD, 'vibe.js': sdk, 'lib/vibedata.js': sdk }, { allowedHosts: [PROXY_HOST] });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
});

test('a generated file under another name is still scanned', () => {
    const r = scanGenerated({ 'index.html': GOOD, 'js/app.js': `var k = "${KEY}";` }, { allowedHosts: [PROXY_HOST] });
    assert.equal(r.ok, false); assert.equal(r.findings[0].file, 'js/app.js');
});

test('every finding kind carries fix guidance without any value', () => {
    const bad = scanGenerated({ 'index.html': `${GOOD}<script src="https://cdn.example.com/x.js"></script><script>fetch(someVar)</script><script>fetch('http://localhost:3000/a')</script><script>var k="${KEY}"</script><script>fetch('https://x.example.com/a')</script>` }, { allowedHosts: [PROXY_HOST] });
    const kinds = new Set(bad.findings.map((f) => f.kind));
    assert.deepEqual([...kinds].sort(), ['external_request', 'external_script', 'hardcoded_secret', 'private_request', 'unverifiable_request']);
    for (const p of bad.problems) assert.match(p, /\b(remove|use|do not|never|call|keep)\b/i, p);
    assert.equal(JSON.stringify(bad).includes(KEY), false);
});

// ---------- generateApp + scan
const fakeLlm = (script) => { const calls = []; return { calls, isOpen: () => false, chat: async ({ model, messages }) => { calls.push({ model, messages: messages.map((m) => ({ ...m })) }); return { text: script[model].shift(), costUsd: 0.01 }; } }; };
const scan = (files) => scanGenerated(files, { allowedHosts: [PROXY_HOST] });

test('generate: findings go into the existing fix pass (kind/file/line only) and a corrected draft is accepted', async () => {
    const llm = fakeLlm({ a: [block('index.html', WITH_KEY), block('index.html', GOOD)] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a'], rules: 'rules', scan });
    assert.equal(r.ok, true); assert.equal(r.fixes, 1); assert.equal(llm.calls.length, 2);
    const fixReq = llm.calls[1].messages.at(-1).content;
    assert.match(fixReq, /hardcoded_secret/); assert.match(fixReq, /index\.html/);
    assert.equal(fixReq.includes(KEY), false, 'the fix request must not contain the secret value');
    assert.equal(fixReq.includes(KEY.slice(0, 12)), false);
});

test('generate: still failing the scan after the fix pass fails the build with cause scan_failed and records safe attempts', async () => {
    const bad = block('index.html', WITH_KEY);
    const llm = fakeLlm({ a: [bad, bad], b: [bad, bad] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a', 'b'], rules: 'rules', scan });
    assert.equal(r.ok, false); assert.equal(r.cause, 'scan_failed');
    assert.ok(r.attempts.every((a) => a.cause === 'scan_failed'));
    assert.equal(JSON.stringify(r).includes(KEY), false, 'attempts and problems must not carry the value');
    assert.ok(r.attempts[0].problems.length >= 1);
});

test('generate: a request the scanner cannot verify is blocked the same way and the fix pass can rescue it', async () => {
    const dynamic = page("var u = location.hash.slice(1); fetch(u).then(function(r){return r.text()}).then(function(t){document.getElementById('out').textContent=t})");
    const llm = fakeLlm({ a: [block('index.html', dynamic), block('index.html', GOOD)] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a'], rules: 'rules', scan });
    assert.equal(r.ok, true); assert.match(llm.calls[1].messages.at(-1).content, /unverifiable_request/);
});

test('generate: the scan only runs after the normal checks pass, and does not run on a blank reply', async () => {
    let scans = 0;
    const llm = fakeLlm({ a: [block('index.html', '<p>blank</p>'), block('index.html', GOOD)] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a'], rules: 'rules', scan: (f) => { scans += 1; return scan(f); } });
    assert.equal(r.ok, true); assert.equal(scans, 1, 'scanned the corrected draft once, not the blank one');
});

test('generate: an edit scans the merged project, so a bad untouched file still blocks delivery', async () => {
    const existing = { 'index.html': GOOD, 'js/old.js': `var k = "${KEY}";` };
    const llm = fakeLlm({ a: [block('js/app.js', 'let a = 1;'), block('js/app.js', 'let a = 2;')] });
    const r = await generateApp({ prompt: 'change', kind: 'tweak', existing, llm, models: ['a'], rules: 'rules', scan });
    assert.equal(r.ok, false); assert.equal(r.cause, 'scan_failed');
});

test('generate: without a scan function behavior is unchanged', async () => {
    const llm = fakeLlm({ a: [block('index.html', WITH_KEY)] });
    assert.equal((await generateApp({ prompt: 'x', llm, models: ['a'], rules: 'rules' })).ok, true);
});

test('generate: a check failure on one model and a scan failure on another reports scan_failed (the safety cause wins)', async () => {
    const llm = fakeLlm({ a: [block('index.html', '<p>blank</p>'), block('index.html', '<p>blank</p>')], b: [block('index.html', WITH_KEY), block('index.html', WITH_KEY)] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a', 'b'], rules: 'rules', scan });
    assert.equal(r.cause, 'scan_failed');
});

// ---------- outcome, messages, prompt rules
test('scan_failed is a recorded outcome result and is not coerced to provider_error', () => {
    assert.ok(RESULTS.includes('scan_failed'));
    const lines = [];
    makeOutcomeLogger({ file: null, write: (s) => lines.push(s) })({ result: 'scan_failed', kind: 'generate' });
    assert.equal(JSON.parse(lines[0]).result, 'scan_failed');
});

test('the user-facing message for scan_failed is clear, safe and free of internals', () => {
    const m = userMessageForCause('scan_failed', 'fallback');
    assert.ok(m.length > 40); assert.match(m, /secret|key/i); assert.match(m, /try again/i);
    assert.equal(/vibe-proxy|scanner|hardcoded_secret|http/i.test(m), false);
    assert.equal(userMessageForCause('check_failed', 'fallback'), 'fallback');
    assert.equal(userMessageForCause(undefined, 'fallback'), 'fallback');
});

test('the generation rules tell the model what [SECRET:NAME] means and that the app must never contain the value', () => {
    assert.match(VIBE_RULES, /\[SECRET:NAME\]/);
    assert.match(VIBE_RULES, /vault/i); assert.match(VIBE_RULES, /proxy/i);
    assert.match(VIBE_RULES, /never[^.]*(value|contain)/i);
    assert.match(BUILD_RULES, /\[SECRET:/);
});
