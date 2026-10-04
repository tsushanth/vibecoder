import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFiles, writeFiles, readProject } from '../../lib/files.js';
import { OpenRouterClient, ProviderError } from '../../lib/llm.js';
import { staticChecks } from '../../lib/checks.js';
import { generateApp } from '../../lib/generate.js';
import { makeOutcomeLogger } from '../../lib/outcome.js';

const GOOD_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title></head><body><button id="b">go</button><div id="out">${'x'.repeat(120)}</div><script>document.getElementById('b').onclick=()=>{document.getElementById('out').textContent='ok'}</script></body></html>`;
const block = (p, c) => `<file path="${p}">\n${c}\n</file>`;

// ---------- files
test('parseFiles tolerates prose and fences, skips vibedata.js, rejects bad paths', () => {
    const text = `Sure!\n${block('index.html', '```html\n<p>hi</p>\n```')}\n${block('../evil.js', 'x')}\n${block('/abs.js', 'x')}\n${block('vibedata.js', 'x')}\n${block('./js/app.js', 'let a=1')}`;
    const { files, rejected } = parseFiles(text);
    // a leading slash is normalized to a project-relative path (cannot escape), traversal is rejected
    assert.deepEqual(Object.keys(files).sort(), ['abs.js', 'index.html', 'js/app.js']);
    assert.equal(files['index.html'], '<p>hi</p>');
    assert.deepEqual(rejected, ['../evil.js']);
});
test('parseFiles returns nothing for prose-only replies', () => {
    assert.deepEqual(parseFiles('I cannot build that, but how about a simulator?').files, {});
});
test('writeFiles refuses to escape the project and readProject never truncates silently', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-'));
    writeFiles(dir, { 'index.html': 'a', 'js/app.js': 'b' });
    assert.equal(fs.readFileSync(path.join(dir, 'js/app.js'), 'utf8'), 'b');
    assert.throws(() => writeFiles(dir, { '../x.txt': 'no' }), /escapes/);
    const small = readProject(dir, { maxBytes: 100 });
    assert.equal(small.tooLarge, false);
    assert.deepEqual(Object.keys(small.files).sort(), ['index.html', 'js/app.js']);
    const big = readProject(dir, { maxBytes: 1 });
    assert.equal(big.tooLarge, true);
    fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- llm client
const resp = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const okBody = (text, extra = {}) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { cost: 0.01 }, ...extra });
function fakeFetch(seq) { let i = 0; const calls = []; const f = async (url, opts) => { calls.push(JSON.parse(opts.body)); const r = seq[Math.min(i++, seq.length - 1)]; return r(); }; f.calls = calls; return f; }
const mk = (fetchImpl, o = {}) => new OpenRouterClient({ apiKey: 'k', fetchImpl, sleep: async () => {}, ...o });

test('llm retries 429 and then succeeds, tracking cost', async () => {
    const f = fakeFetch([resp(429, {}), resp(200, okBody('hi'))]);
    const c = mk(f);
    const r = await c.chat({ model: 'm', messages: [] });
    assert.equal(r.text, 'hi');
    assert.equal(f.calls.length, 2);
    assert.equal(c.spentToday, 0.01);
});
test('llm doubles max_tokens after an empty reply that hit the length limit', async () => {
    const f = fakeFetch([resp(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { cost: 0 } }), resp(200, okBody('answer'))]);
    const r = await mk(f).chat({ model: 'm', messages: [], maxTokens: 1000 });
    assert.equal(r.text, 'answer');
    assert.equal(f.calls[0].max_tokens, 1000);
    assert.equal(f.calls[1].max_tokens, 2000);
});
test('llm does not retry a non-retryable error', async () => {
    const f = fakeFetch([resp(401, {})]);
    await assert.rejects(mk(f).chat({ model: 'm', messages: [] }), (e) => e instanceof ProviderError && e.status === 401);
    assert.equal(f.calls.length, 1);
});
test('llm breaker opens after repeated failures and closes after the window', async () => {
    let t = 1000;
    const f = fakeFetch([resp(500, {})]);
    const c = mk(f, { now: () => t, maxAttempts: 1, breakerFailures: 2, breakerMs: 5000 });
    await assert.rejects(c.chat({ model: 'm', messages: [] }));
    assert.equal(c.isOpen('m'), false);
    await assert.rejects(c.chat({ model: 'm', messages: [] }));
    assert.equal(c.isOpen('m'), true);
    t += 6000;
    assert.equal(c.isOpen('m'), false);
});
test('llm stops when the daily budget is exceeded', async () => {
    const f = fakeFetch([resp(200, okBody('a', { usage: { cost: 2 } }))]);
    const c = mk(f, { dailyBudgetUsd: 1 });
    await c.chat({ model: 'm', messages: [] });
    await assert.rejects(c.chat({ model: 'm', messages: [] }), /budget/);
});

// ---------- checks
test('staticChecks accepts a good app and flags blank, external, syntax and viewport problems', () => {
    assert.equal(staticChecks({ 'index.html': GOOD_HTML }).ok, true);
    assert.deepEqual(staticChecks({ 'index.html': '<p>x</p>' }).problems, ['no usable index.html']);
    const ext = staticChecks({ 'index.html': GOOD_HTML.replace('<title>', '<script src="https://cdn.example.com/x.js"></script><title>') });
    assert.equal(ext.ok, false);
    assert.match(ext.problems.join(' '), /External URL/);
    const bad = staticChecks({ 'index.html': GOOD_HTML.replace("'ok'", "'ok'}}}") });
    assert.equal(bad.ok, false);
    assert.match(bad.problems.join(' '), /syntax error/);
    const novp = staticChecks({ 'index.html': GOOD_HTML.replace(/<meta name="viewport"[^>]*>/, '') });
    assert.deepEqual(novp.problems, ['missing viewport meta']);
    assert.equal(staticChecks({ 'index.html': GOOD_HTML, 'js/app.js': 'function (' }).ok, false);
});

// ---------- generate chain with fake providers
const fakeLlm = (script, { open = [] } = {}) => {
    const calls = [];
    return { calls, isOpen: (m) => open.includes(m), chat: async ({ model, messages }) => { calls.push({ model, n: messages.length }); const r = script[model]?.shift(); if (r instanceof Error) throw r; return { text: r, costUsd: 0.01 }; } };
};
const RULES = 'rules';

test('generate: first model passes', async () => {
    const llm = fakeLlm({ a: [block('index.html', GOOD_HTML)] });
    const r = await generateApp({ prompt: 'a counter', llm, models: ['a', 'b'], rules: RULES });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'a');
    assert.equal(r.fixes, 0);
    assert.equal(llm.calls.length, 1);
});
test('generate: the fix pass rescues a failing first draft', async () => {
    const llm = fakeLlm({ a: [block('index.html', '<p>blank</p>'), block('index.html', GOOD_HTML)] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a'], rules: RULES });
    assert.equal(r.ok, true);
    assert.equal(r.fixes, 1);
    assert.equal(llm.calls.length, 2);
    assert.equal(llm.calls[1].n, 4); // system, user, assistant, fix request
});
test('generate: falls through to the next model after a provider error', async () => {
    const llm = fakeLlm({ a: [new ProviderError('HTTP 500', { retryable: true })], b: [block('index.html', GOOD_HTML)] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a', 'b'], rules: RULES });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'b');
    assert.equal(r.attempts[0].cause, 'provider_error');
});
test('generate: skips a model whose breaker is open', async () => {
    const llm = fakeLlm({ b: [block('index.html', GOOD_HTML)] }, { open: ['a'] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a', 'b'], rules: RULES });
    assert.equal(r.model, 'b');
    assert.equal(r.attempts[0].skipped, 'breaker open');
});
test('generate: prose-only reply is classified as declined_text without wasting a fix pass', async () => {
    const llm = fakeLlm({ a: ['How about a simulator instead?'] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a'], rules: RULES });
    assert.equal(r.ok, false);
    assert.equal(r.cause, 'declined_text');
    assert.equal(llm.calls.length, 1);
});
test('generate: all models fail checks gives check_failed', async () => {
    const bad = block('index.html', '<p>blank</p>');
    const llm = fakeLlm({ a: [bad, bad], b: [bad, bad] });
    const r = await generateApp({ prompt: 'x', llm, models: ['a', 'b'], rules: RULES });
    assert.equal(r.ok, false);
    assert.equal(r.cause, 'check_failed');
    assert.equal(llm.calls.length, 4);
});
test('generate: an edit merges changed files into the existing project before checking', async () => {
    const existing = { 'index.html': GOOD_HTML, 'js/app.js': 'let a = 1;' };
    const llm = fakeLlm({ a: [block('js/app.js', 'let a = 2;')] });
    const r = await generateApp({ prompt: 'change a', kind: 'tweak', existing, llm, models: ['a'], rules: RULES });
    assert.equal(r.ok, true);
    assert.equal(r.files['js/app.js'], 'let a = 2;');
    assert.equal(r.files['index.html'], GOOD_HTML);
});

// ---------- outcome log
test('outcome logger writes one JSON line and coerces unknown results', () => {
    const lines = [];
    const log = makeOutcomeLogger({ file: null, write: (s) => lines.push(s) });
    log({ requestId: 'r1', kind: 'generate', result: 'ok', model: 'a' });
    log({ requestId: 'r2', kind: 'generate', result: 'mystery' });
    assert.equal(lines.length, 2);
    const a = JSON.parse(lines[0]);
    assert.equal(a.event, 'build_outcome');
    assert.equal(a.result, 'ok');
    assert.equal(JSON.parse(lines[1]).result, 'provider_error');
});
