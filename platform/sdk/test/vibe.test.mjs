import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../vibe.js', import.meta.url)), 'utf8');

function load({ host = 'myapp.vibebuild.cc', win = {}, reply } = {}) {
    const calls = [];
    const ctx = {
        location: { hostname: host },
        fetch: async (url, init) => {
            calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
            if (reply === 'network') throw new TypeError('Failed to fetch');
            if (typeof reply === 'function') return reply(url, init);
            return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
        AbortController, setTimeout, clearTimeout, JSON, Promise, Error, encodeURIComponent, Object, Array, Number, String, URLSearchParams,
    };
    ctx.window = ctx;
    Object.assign(ctx, { VIBE_BASE: 'https://proxy.test', ...win });
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return { vibe: ctx.vibe, calls, ctx };
}
const jsonRes = (status, obj, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

test('exposes only api, ai and version', () => {
    assert.deepEqual(Object.keys(load().vibe).sort(), ['ai', 'api', 'version']);
    assert.deepEqual(Object.keys(load().vibe.ai).sort(), ['ask', 'chat']);
});

test('api posts the connector call to the app proxy endpoint and returns parsed JSON', async () => {
    const { vibe, calls } = load();
    const r = await vibe.api('nws', '/points/39,-97', { query: { a: '1' } });
    assert.deepEqual(r, { ok: 1 });
    assert.equal(calls[0].url, 'https://proxy.test/myapp/api');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].body, { connector: 'nws', method: 'GET', path: '/points/39,-97', query: { a: '1' } });
});

test('api passes method and body through', async () => {
    const { vibe, calls } = load();
    await vibe.api('hook', '/x', { method: 'post', body: { a: 1 } });
    assert.deepEqual(calls[0].body, { connector: 'hook', method: 'POST', path: '/x', body: { a: 1 } });
});

test('api never sends caller-supplied credentials or headers, only content-type', async () => {
    const { vibe, calls } = load();
    await vibe.api('hook', '/x', { headers: { authorization: 'Bearer abc' }, apiKey: 'sk-live', body: {} });
    assert.deepEqual(Object.keys(calls[0].init.headers), ['Content-Type']);
    assert.equal(JSON.stringify(calls[0].body).includes('sk-live'), false);
    assert.equal(Object.hasOwn(calls[0].body, 'headers'), false);
});

test('app id comes from the host, or from window.VIBE_APP_ID for custom domains', async () => {
    const a = load({ host: 'cool-game.vibebuild.cc' });
    await a.vibe.api('nws', '/points/1,1');
    assert.equal(a.calls[0].url, 'https://proxy.test/cool-game/api');
    const b = load({ host: 'example.com', win: { VIBE_APP_ID: 'custom1' } });
    await b.vibe.api('nws', '/points/1,1');
    assert.equal(b.calls[0].url, 'https://proxy.test/custom1/api');
});

test('an unknown app id rejects the promise and makes no request', async () => {
    const { vibe, calls } = load({ host: 'example.com' });
    await assert.rejects(() => vibe.api('nws', '/x'), /app id/i);
    assert.equal(calls.length, 0);
});

test('a non-JSON response resolves as text', async () => {
    const { vibe } = load({ reply: async () => new Response('plain', { status: 200, headers: { 'content-type': 'text/plain' } }) });
    assert.equal(await vibe.api('nws', '/x'), 'plain');
});

test('an error response rejects with status, code and retryAfter', async () => {
    const { vibe } = load({ reply: async () => jsonRes(429, { error: 'rate_limited_ip' }, { 'retry-after': '12' }) });
    await assert.rejects(() => vibe.api('nws', '/x'), (e) => e instanceof Error && e.status === 429 && e.code === 'rate_limited_ip' && e.retryAfter === 12);
});

test('a network failure rejects with status 0 and code network', async () => {
    const { vibe } = load({ reply: 'network' });
    await assert.rejects(() => vibe.api('nws', '/x'), (e) => e.status === 0 && e.code === 'network');
});

test('a slow response rejects with code timeout', async () => {
    const { vibe } = load({ win: { VIBE_TIMEOUT_MS: 30 }, reply: (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))) });
    await assert.rejects(() => vibe.api('nws', '/x'), (e) => e.code === 'timeout');
});

test('ai.chat posts messages and options to the ai endpoint and returns text and usage', async () => {
    const { vibe, calls } = load({ reply: async () => jsonRes(200, { text: 'hi', usage: { promptTokens: 1, completionTokens: 2 } }) });
    const r = await vibe.ai.chat([{ role: 'user', content: 'yo' }], { maxTokens: 50, temperature: 0.3 });
    assert.deepEqual(r, { text: 'hi', usage: { promptTokens: 1, completionTokens: 2 } });
    assert.equal(calls[0].url, 'https://proxy.test/myapp/ai');
    assert.deepEqual(calls[0].body, { messages: [{ role: 'user', content: 'yo' }], maxTokens: 50, temperature: 0.3 });
});

test('ai.chat does not let the app pick a model or send keys', async () => {
    const { vibe, calls } = load({ reply: async () => jsonRes(200, { text: 'x', usage: {} }) });
    await vibe.ai.chat([{ role: 'user', content: 'yo' }], { model: 'anthropic/claude-opus-5-5', apiKey: 'sk-x' });
    assert.deepEqual(Object.keys(calls[0].body), ['messages']);
});

test('ai.ask sends an optional system message plus the prompt and resolves the text', async () => {
    const { vibe, calls } = load({ reply: async () => jsonRes(200, { text: 'answer', usage: {} }) });
    assert.equal(await vibe.ai.ask('why?', { system: 'be brief' }), 'answer');
    assert.deepEqual(calls[0].body.messages, [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'why?' }]);
});

test('ai.chat rejects bad input locally without a request', async () => {
    const { vibe, calls } = load();
    await assert.rejects(() => vibe.ai.chat([]), /messages/i);
    await assert.rejects(() => vibe.ai.chat('hi'), /messages/i);
    await assert.rejects(() => vibe.ai.ask(''), /prompt/i);
    assert.equal(calls.length, 0);
});

test('the SDK source embeds no credentials and no hostname other than the configurable default base', () => {
    assert.equal(/sk-|AIza|ghp_|AKIA/.test(SRC), false);
    const hosts = [...SRC.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
    assert.ok(hosts.every((h) => h === 'vibe-proxy.vibebuild.cc'), hosts.join(','));
});
