import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuggestionTranslator, normalizeLang, SUPPORTED_LANGS } from '../../lib/suggestionI18n.js';

const ITEMS = [
    { label: 'Task Manager', prompt: 'Build a Kanban-style task manager with drag and drop columns' },
    { label: 'Quiz Game', prompt: 'Build an interactive quiz game with a timer' },
];

// A fake model: replies with "[lang] ..." for every item it is given, and counts calls.
function fakeApi({ status = 200, text, throwErr } = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push(body);
        if (throwErr) throw throwErr;
        const input = JSON.parse(body.messages[0].content.match(/Input JSON:\n(\[.*\])\n/s)[1]);
        const out = text ?? JSON.stringify(input.map((o) => ({ i: o.i, label: `T:${o.label}`, prompt: `T:${o.prompt}` })));
        return new Response(JSON.stringify({ model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: out }], usage: { input_tokens: 10, output_tokens: 20 } }), { status });
    };
    return { calls, fetchImpl };
}
const make = (api, extra = {}) => createSuggestionTranslator({ getApiKey: () => 'k', fetchImpl: api.fetchImpl, recordLlm: () => {}, log: () => {}, ...extra });

test('whitelist: the 26 app languages, aliases for Android codes, everything else is English', () => {
    assert.equal(SUPPORTED_LANGS.length, 26);
    for (const t of SUPPORTED_LANGS) assert.equal(normalizeLang(t), t);
    assert.equal(normalizeLang('in'), 'id');
    assert.equal(normalizeLang('pt-BR'), 'pt');
    assert.equal(normalizeLang('zh-CN'), 'zh');
    assert.equal(normalizeLang('FR'), 'fr');
    for (const bad of ['', 'xx', 'en', 'en-US', 'klingon', '../etc', 'de;DROP', undefined, null, 42, {}, ['de']]) assert.equal(normalizeLang(bad), 'en', String(bad));
});

test('default English: no lang, en or an unknown tag returns the same items and never calls the model', async () => {
    const api = fakeApi(); const t = make(api);
    for (const l of [undefined, '', 'en', 'xx']) assert.deepEqual(await t.localize(ITEMS, l), ITEMS);
    assert.equal(api.calls.length, 0);
});

test('translates label and prompt, asks for the right language, and keeps the item shape', async () => {
    const api = fakeApi(); const t = make(api);
    const out = await t.localize(ITEMS, 'de');
    assert.deepEqual(out, ITEMS.map((s) => ({ label: `T:${s.label}`, prompt: `T:${s.prompt}` })));
    assert.equal(api.calls.length, 1);
    assert.match(api.calls[0].messages[0].content, /German/);
    assert.deepEqual(ITEMS[0], { label: 'Task Manager', prompt: 'Build a Kanban-style task manager with drag and drop columns' }); // input not mutated
});

test('cache hit: the same items in the same language are translated once; another language is a separate entry', async () => {
    const api = fakeApi(); const t = make(api);
    await t.localize(ITEMS, 'fr');
    await t.localize(ITEMS, 'fr-CA');
    await t.localize([ITEMS[1], ITEMS[0]], 'fr');
    assert.equal(api.calls.length, 1);
    await t.localize(ITEMS, 'es');
    assert.equal(api.calls.length, 2);
    // a partly cached request only sends the missing item
    const extra = { label: 'Notes App', prompt: 'Build a markdown notes app' };
    await t.localize([ITEMS[0], extra], 'fr');
    assert.equal(api.calls.length, 3);
    assert.equal(JSON.parse(api.calls[2].messages[0].content.match(/Input JSON:\n(\[.*\])\n/s)[1]).length, 1);
});

test('concurrent identical requests share one model call', async () => {
    const api = fakeApi(); const t = make(api);
    const [a, b] = await Promise.all([t.localize(ITEMS, 'it'), t.localize(ITEMS, 'it')]);
    assert.equal(api.calls.length, 1);
    assert.deepEqual(a, b);
});

test('failure falls back to the English items: HTTP error, network error, garbage, no key', async () => {
    for (const api of [fakeApi({ status: 529 }), fakeApi({ throwErr: new TypeError('fetch failed') }), fakeApi({ text: 'sorry, no json' }), fakeApi({ text: '[{"i":0}]' })]) {
        const t = make(api);
        assert.deepEqual(await t.localize(ITEMS, 'ja'), ITEMS);
    }
    const t = createSuggestionTranslator({ getApiKey: () => '', fetchImpl: () => { throw new Error('must not be called'); }, recordLlm: () => {}, log: () => {} });
    assert.deepEqual(await t.localize(ITEMS, 'ja'), ITEMS);
});

test('a partly valid reply translates what it can and leaves the rest English', async () => {
    const api = fakeApi({ text: JSON.stringify([{ i: 1, label: 'Quiz', prompt: 'Spiel' }, { i: 0, label: '', prompt: 'x' }]) });
    const out = await make(api).localize(ITEMS, 'de');
    assert.deepEqual(out, [ITEMS[0], { label: 'Quiz', prompt: 'Spiel' }]);
});

test('after a failure the language cools down (no hammering), then retries and recovers', async () => {
    let t0 = 1000; const api = fakeApi({ status: 500 });
    const t = make(api, { now: () => t0, failureCooldownMs: 60000 });
    await t.localize(ITEMS, 'ko'); await t.localize(ITEMS, 'ko');
    assert.equal(api.calls.length, 1);
    t0 += 61000;
    await t.localize(ITEMS, 'ko');
    assert.equal(api.calls.length, 2);
    await t.localize(ITEMS, 'th'); // other languages are unaffected by the cooldown
    assert.equal(api.calls.length, 3);
});

test('records one accounting row per upstream attempt under suggestions_translate', async () => {
    const rows = [];
    const ok = make(fakeApi(), { recordLlm: (r) => rows.push(r) });
    await ok.localize(ITEMS, 'nl');
    const bad = make(fakeApi({ status: 500 }), { recordLlm: (r) => rows.push(r) });
    await bad.localize(ITEMS, 'nl');
    assert.deepEqual(rows.map((r) => [r.feature, r.ok !== false]), [['suggestions_translate', true], ['suggestions_translate', false]]);
});

test('englishPromptFor maps a translated prompt back to its English source', async () => {
    const t = make(fakeApi());
    const [first] = await t.localize(ITEMS, 'sv');
    assert.equal(t.englishPromptFor(first.prompt), ITEMS[0].prompt);
    assert.equal(t.englishPromptFor('something typed by the user'), 'something typed by the user');
});

test('the cache is bounded', async () => {
    const t = make(fakeApi(), { maxCacheEntries: 3 });
    for (let i = 0; i < 6; i++) await t.localize([{ label: `L${i}`, prompt: `P${i}` }], 'pl');
    assert.ok(t._stats().cached <= 3);
});

test('larger requests are split into small batches that are translated in parallel', async () => {
    const api = fakeApi(); const t = make(api);
    const many = Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, prompt: `P${i}` }));
    const out = await t.localize(many, 'hi');
    assert.equal(api.calls.length, 3); // 3 + 3 + 1
    assert.deepEqual(out, many.map((s) => ({ label: `T:${s.label}`, prompt: `T:${s.prompt}` })));
});
