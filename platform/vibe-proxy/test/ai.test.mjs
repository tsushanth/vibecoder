import test from 'node:test';
import assert from 'node:assert/strict';
import { aiChat } from '../ai.js';
import { createLimiter, memoryStore } from '../limits.js';
import { createMeter } from '../meter.js';

const KEY = 'sk-or-v1-FAKEKEYFORTESTSONLY0123456789';

function rig(o = {}) {
    let t = Date.UTC(2026, 9, 5, 12, 0, 10);
    const now = () => t;
    const limiter = createLimiter({ store: memoryStore({ now }), now, perIpPerMin: 100, perAppPerMin: 100, dailyCalls: 1000, dailySpendMicros: o.cap ?? 5000 });
    const events = [];
    const meter = createMeter({ sink: async (e) => { events.push(e); }, now });
    const calls = [];
    const reply = o.reply ?? { choices: [{ message: { content: 'hello there' } }], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.002 } };
    const fetchImpl = o.fetchImpl || (async (url, init) => { calls.push({ url: String(url), init, body: JSON.parse(init.body) }); return new Response(JSON.stringify(reply), { status: o.status || 200, headers: { 'content-type': 'application/json' } }); });
    const run = (req, extra = {}) => aiChat({ req, appId: 'app1', ip: '1.1.1.1', apiKey: KEY, fetchImpl, limiter, meter, ...extra });
    return { run, calls, events };
}
const ask = { messages: [{ role: 'user', content: 'hi' }] };
const parse = (r) => JSON.parse(r.body);

test('returns only the reply text and token counts, never cost or provider details', async () => {
    const { run } = rig();
    const r = await run(ask);
    assert.equal(r.status, 200);
    assert.deepEqual(parse(r), { text: 'hello there', usage: { promptTokens: 12, completionTokens: 3 } });
});

test('calls the OpenRouter chat endpoint with the key, the default model and capped tokens', async () => {
    const { run, calls } = rig();
    await run({ ...ask, maxTokens: 100000, temperature: 9 });
    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer ' + KEY);
    assert.equal(calls[0].body.model, 'openai/gpt-5.6-luna');
    assert.equal(calls[0].body.max_tokens, 800);
    assert.ok(calls[0].body.temperature <= 1.5);
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['max_tokens', 'messages', 'model', 'temperature', 'usage']);
});

test('a model outside the allowlist is replaced by the default, not passed through', async () => {
    const { run, calls } = rig();
    await run({ ...ask, model: 'anthropic/claude-opus-5-5' });
    assert.equal(calls[0].body.model, 'openai/gpt-5.6-luna');
});

for (const [name, req] of [
    ['no messages', { messages: [] }],
    ['messages that are not an array', { messages: 'hi' }],
    ['an unknown role', { messages: [{ role: 'tool', content: 'x' }] }],
    ['non-string content', { messages: [{ role: 'user', content: { a: 1 } }] }],
    ['too many messages', { messages: Array.from({ length: 25 }, () => ({ role: 'user', content: 'x' })) }],
]) {
    test(`rejects ${name} with 400 and no upstream call`, async () => {
        const { run, calls } = rig();
        assert.equal((await run(req)).status, 400);
        assert.equal(calls.length, 0);
    });
}

test('rejects oversized input with 413 and no upstream call', async () => {
    const { run, calls } = rig();
    assert.equal((await run({ messages: [{ role: 'user', content: 'a'.repeat(9000) }] })).status, 413);
    assert.equal(calls.length, 0);
});

test('records the provider-reported cost in micro-dollars against the app spend cap', async () => {
    const { run } = rig({ cap: 3000 });
    assert.equal((await run(ask)).status, 200);      // costs 2000
    assert.equal((await run(ask)).status, 200);      // total 4000, over the cap, but that call started under it
    const r = await run(ask);
    assert.equal(r.status, 429);
    assert.equal(parse(r).error, 'spend_cap');
});

test('a call that reports no cost is charged a conservative minimum so the cap still works', async () => {
    const { run } = rig({ cap: 3000, reply: { choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } });
    let last;
    for (let i = 0; i < 90; i++) { last = await run(ask); if (last.status === 429) break; }
    assert.equal(last.status, 429);
    assert.equal(parse(last).error, 'spend_cap');
});

test('a limiter denial is returned without calling the provider', async () => {
    const { run, calls } = rig();
    const r = await run(ask, { limiter: { check: async () => ({ ok: false, reason: 'rate_limited_ip', retryAfterSec: 12 }), recordSpend: async () => {} } });
    assert.equal(r.status, 429); assert.equal(r.headers['retry-after'], '12'); assert.equal(calls.length, 0);
});

test('provider errors are 502 with a generic body that never contains the key or provider text', async () => {
    const { run } = rig({ status: 401, reply: { error: { message: `bad key ${KEY}` } } });
    const r = await run(ask);
    assert.equal(r.status, 502);
    assert.equal(JSON.stringify(r).includes(KEY), false);
    assert.equal(r.body.includes('bad key'), false);
});

test('redirects from the provider are not followed', async () => {
    const { run, calls } = rig();
    await run(ask);
    assert.equal(calls[0].init.redirect, 'manual');
});

test('an empty provider reply is 502', async () => {
    const { run } = rig({ reply: { choices: [{ message: { content: '' } }], usage: {} } });
    assert.equal((await run(ask)).status, 502);
});

test('a slow provider is 504', async () => {
    const slow = async (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
    const { run } = rig({ fetchImpl: slow });
    assert.equal((await run(ask, { config: { timeoutMs: 50 } })).status, 504);
});

test('usage events record the call as connector ai with sizes only, no prompt text', async () => {
    const { run, events } = rig();
    await run({ messages: [{ role: 'user', content: 'my private question about Springfield' }] });
    assert.equal(events[0].connector, 'ai');
    assert.equal(JSON.stringify(events).includes('Springfield'), false);
    assert.equal(JSON.stringify(events).includes(KEY), false);
});

test('a missing platform key is 503 and no call is made', async () => {
    const { run, calls } = rig();
    assert.equal((await run(ask, { apiKey: '' })).status, 503);
    assert.equal(calls.length, 0);
});
