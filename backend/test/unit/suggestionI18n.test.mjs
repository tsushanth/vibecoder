import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuggestionTranslator, normalizeLang, languageName, parseTranslations, parseIdeaList, SUPPORTED_LANGS } from '../../lib/suggestionI18n.js';

const ITEMS = [
    { label: 'Task Manager', prompt: 'Build a Kanban-style task manager with drag and drop columns' },
    { label: 'Quiz Game', prompt: 'Build an interactive quiz game with a timer' },
];

// The request lists the items as "===ITEM n===\nlabel: ..\nprompt: .." blocks; the fake model answers in the same format.
const inputOf = (body) => [...body.messages[0].content.matchAll(/^===ITEM (\d+)===\nlabel: (.*)\nprompt: (.*)$/gm)].map((m) => ({ i: Number(m[1]), label: m[2], prompt: m[3] }));
const delimited = (rows) => rows.map((o) => `===ITEM ${o.i}===\nlabel: ${o.label}\nprompt: ${o.prompt}`).join('\n') + '\n===END===';

// A fake model: replies with "[lang] ..." for every item it is given, and counts calls.
function fakeApi({ status = 200, text, throwErr } = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push(body);
        if (throwErr) throw throwErr;
        const input = inputOf(body);
        const out = typeof text === 'function' ? text(input, calls.length - 1) : (text ?? delimited(input.map((o) => ({ i: o.i, label: `T:${o.label}`, prompt: `T:${o.prompt}` }))));
        return new Response(JSON.stringify({ model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: out }], usage: { input_tokens: 10, output_tokens: 20 } }), { status });
    };
    return { calls, fetchImpl };
}
const make = (api, extra = {}) => createSuggestionTranslator({ getApiKey: () => 'k', fetchImpl: api.fetchImpl, recordLlm: () => {}, log: () => {}, ...extra });

test('whitelist: the 26 app languages, aliases for Android codes, everything else is English', () => {
    assert.equal(SUPPORTED_LANGS.length, 28);
    for (const t of SUPPORTED_LANGS) assert.equal(normalizeLang(t), t);
    assert.equal(normalizeLang('in'), 'id');
    assert.equal(normalizeLang('pt-BR'), 'pt');
    assert.equal(normalizeLang('zh-CN'), 'zh');
    assert.equal(normalizeLang('zh'), 'zh'); // old clients
    for (const sc of ['zh-SG', 'zh-Hans', 'zh-Hans-CN', 'zh_cn', 'zh-Hans-HK']) assert.equal(normalizeLang(sc), 'zh', sc);
    for (const tw of ['zh-TW', 'zh_tw', 'zh-Hant', 'zh-Hant-TW', 'zh-MO', 'zh-Hant-MO']) assert.equal(normalizeLang(tw), 'zh-TW', tw);
    for (const hk of ['zh-HK', 'zh-hk', 'zh-Hant-HK']) assert.equal(normalizeLang(hk), 'zh-HK', hk);
    assert.equal(languageName('zh'), 'Simplified Chinese');
    assert.equal(languageName('zh-TW'), 'Traditional Chinese (Taiwan)');
    assert.equal(languageName('zh-HK'), 'Traditional Chinese (Hong Kong)');
    for (const proto of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) { assert.equal(normalizeLang(proto), 'en', proto); assert.equal(languageName(proto), 'English', proto); }
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
    assert.equal(inputOf(api.calls[2]).length, 1);
});

test('concurrent identical requests share one model call', async () => {
    const api = fakeApi(); const t = make(api);
    const [a, b] = await Promise.all([t.localize(ITEMS, 'it'), t.localize(ITEMS, 'it')]);
    assert.equal(api.calls.length, 1);
    assert.deepEqual(a, b);
});

test('failure falls back to the English items: HTTP error, network error, garbage, no key', async () => {
    for (const api of [fakeApi({ status: 529 }), fakeApi({ throwErr: new TypeError('fetch failed') }), fakeApi({ text: 'sorry, no json' }), fakeApi({ text: '[{"i":0}]' }), fakeApi({ text: '' })]) {
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

// ---------------- malformed model output ----------------
const TH = [{ label: 'Task Manager', prompt: 'Build a "Kanban" board' }, { label: 'Quiz Game', prompt: 'Build a quiz with a timer' }, { label: 'Notes', prompt: 'Build a notes app' }];
const slot = (l, p) => ({ label: l, prompt: p });

test('parse: delimiter format keeps quotes, brackets, braces and multi-line prompts intact', () => {
    const text = '===ITEM 0===\nlabel: แผนงาน\nprompt: สร้างบอร์ด "Kanban" {a: [b]} ที่ลาก\nและวางได้\n===ITEM 1===\nlabel: เกม\nprompt: ควิซ\n===END===';
    assert.deepEqual(parseTranslations(text, 2), [slot('แผนงาน', 'สร้างบอร์ด "Kanban" {a: [b]} ที่ลาก และวางได้'), slot('เกม', 'ควิซ')]);
});

test('parse: code fences around either format are ignored', () => {
    assert.deepEqual(parseTranslations('```\n===ITEM 0===\nlabel: A\nprompt: B\n===END===\n```', 1), [slot('A', 'B')]);
    assert.deepEqual(parseTranslations('```json\n[{"i":0,"label":"A","prompt":"B"}]\n```', 1), [slot('A', 'B')]);
});

test('parse: JSON with unescaped quotes inside strings is salvaged per item (the Thai failure)', () => {
    const bad = '[{"i":0,"label":"บอร์ด "Kanban"","prompt":"สร้าง "Kanban" ที่ลากได้"},{"i":1,"label":"เกม","prompt":"ควิซ"}]';
    assert.throws(() => JSON.parse(bad));
    assert.deepEqual(parseTranslations(bad, 2), [slot('บอร์ด "Kanban"', 'สร้าง "Kanban" ที่ลากได้'), slot('เกม', 'ควิซ')]);
});

test('parse: truncated JSON keeps the complete items and drops the cut one', () => {
    const cut = '[{"i":0,"label":"A","prompt":"B"},{"i":1,"label":"C","prompt":"D tru';
    assert.deepEqual(parseTranslations(cut, 2), [slot('A', 'B'), null]);
});

test('parse: truncated delimiter output (stop_reason max_tokens) drops the last, possibly cut, item', () => {
    const cut = '===ITEM 0===\nlabel: A\nprompt: B\n===ITEM 1===\nlabel: C\nprompt: D tru';
    assert.deepEqual(parseTranslations(cut, 2, { truncated: true }), [slot('A', 'B'), null]);
    assert.deepEqual(parseTranslations(cut, 2), [slot('A', 'B'), slot('C', 'D tru')]); // not flagged truncated: keep it
});

test('parse: wrong item count (too few, too many, out of range, duplicate index) never throws and never misplaces items', () => {
    assert.deepEqual(parseTranslations('===ITEM 1===\nlabel: B\nprompt: b\n===END===', 3), [null, slot('B', 'b'), null]);
    const many = '===ITEM 0===\nlabel: A\nprompt: a\n===ITEM 1===\nlabel: B\nprompt: b\n===ITEM 7===\nlabel: X\nprompt: x\n===ITEM 0===\nlabel: Z\nprompt: z\n===END===';
    assert.deepEqual(parseTranslations(many, 2), [slot('A', 'a'), slot('B', 'b')]);
    assert.deepEqual(parseTranslations('[{"label":"A","prompt":"a"},{"label":"B","prompt":"b"}]', 2), [slot('A', 'a'), slot('B', 'b')]); // no index, count matches: by position
    assert.deepEqual(parseTranslations('[{"label":"A","prompt":"a"}]', 3), [null, null, null]); // no index and a different count: position is not trusted
});

test('parse: garbage, empty and non-string input give all-null slots', () => {
    for (const t of ['', 'sorry', '[', '{"x":1}', null, undefined, 42, '===ITEM 0===\nnothing here']) assert.deepEqual(parseTranslations(t, 2), [null, null], String(t));
});

test('parseIdeaList: fences, unescaped quotes and a truncated tail keep the complete ideas', () => {
    assert.deepEqual(parseIdeaList('```json\n[{"label":"A","prompt":"a"}]\n```'), [slot('A', 'a')]);
    assert.deepEqual(parseIdeaList('[{"label":"A","prompt":"say "hi" now"},{"label":"B","prompt":"b"},{"label":"C","prompt":"cu'), [slot('A', 'say "hi" now'), slot('B', 'b')]);
    assert.deepEqual(parseIdeaList('nope'), []);
    assert.equal(parseIdeaList('[' + Array.from({ length: 9 }, (_, i) => `{"label":"L${i}","prompt":"P${i}"}`).join(',') + ']').length, 6);
});

test('a batch whose first reply is malformed is retried once for the missing items and ends up translated', async () => {
    const api = fakeApi({ text: (input, n) => (n === 0 ? '[{"i":0,"label":"บอร์ด "K"","prompt":"x "y""' : delimited(input.map((o) => ({ i: o.i, label: `T:${o.label}`, prompt: `T:${o.prompt}` })))) });
    const out = await make(api).localize(TH, 'th');
    assert.deepEqual(out, TH.map((s) => slot(`T:${s.label}`, `T:${s.prompt}`)));
    assert.equal(api.calls.length, 2);
    assert.equal(inputOf(api.calls[1]).length, 3); // nothing was usable in the first reply
});

test('a reply that loses one item retries only that item; the good ones are kept (per-item fallback)', async () => {
    const api = fakeApi({ text: (input, n) => delimited((n === 0 ? input.filter((o) => o.i !== 1) : input).map((o) => ({ i: o.i, label: `T:${o.label}`, prompt: `T:${o.prompt}` }))) });
    const out = await make(api).localize(TH, 'th');
    assert.deepEqual(out, TH.map((s) => slot(`T:${s.label}`, `T:${s.prompt}`)));
    assert.equal(api.calls.length, 2);
    assert.deepEqual(inputOf(api.calls[1]).map((o) => o.label), ['Quiz Game']);
});

test('items that stay unusable after the retry fall back to English individually, the rest of the batch is translated', async () => {
    const api = fakeApi({ text: (input) => delimited(input.filter((o) => o.label !== 'Quiz Game').map((o) => ({ i: o.i, label: `T:${o.label}`, prompt: `T:${o.prompt}` }))) });
    const t = make(api);
    const out = await t.localize(TH, 'th');
    assert.deepEqual(out, [slot('T:Task Manager', 'T:Build a "Kanban" board'), TH[1], slot('T:Notes', 'T:Build a notes app')]);
    assert.equal(api.calls.length, 2); // one try + one retry, never more
    await t.localize(TH, 'th');        // the translated items are cached; the failed one is not hammered again right away
    assert.equal(api.calls.length, 2);
});

test('a transport error on the retry keeps the first reply\'s good items', async () => {
    let n = 0;
    const calls = [];
    const fetchImpl = async (u, init) => {
        const body = JSON.parse(init.body); calls.push(body);
        if (n++ > 0) throw new TypeError('fetch failed');
        const input = inputOf(body).filter((o) => o.i === 0);
        return new Response(JSON.stringify({ content: [{ type: 'text', text: delimited(input.map((o) => ({ i: o.i, label: 'T', prompt: 'T' }))) }] }), { status: 200 });
    };
    const out = await createSuggestionTranslator({ getApiKey: () => 'k', fetchImpl, recordLlm: () => {}, log: () => {} }).localize(TH.slice(0, 2), 'th');
    assert.deepEqual(out, [slot('T', 'T'), TH[1]]);
});

test('cache is per (lang, item): a Thai failure does not poison de, and a repaired item is cached for later requests', async () => {
    const api = fakeApi({ text: (input, n) => (n < 2 ? 'garbage' : delimited(input.map((o) => ({ i: o.i, label: `T:${o.label}`, prompt: `T:${o.prompt}` })))) });
    const t = make(api, { failureCooldownMs: 0 });
    assert.deepEqual(await t.localize(TH.slice(0, 1), 'th'), TH.slice(0, 1)); // both tries garbage
    assert.equal((await t.localize(TH.slice(0, 1), 'de'))[0].label, 'T:Task Manager');
    assert.equal((await t.localize(TH.slice(0, 1), 'th'))[0].label, 'T:Task Manager');
    const before = api.calls.length;
    await t.localize(TH.slice(0, 1), 'th');
    assert.equal(api.calls.length, before);
});

// ---------------- a prompt returned in English ----------------
test('a reply with a translated label but the prompt still English is retried, then the item stays fully English (no mixed chip)', async () => {
    const api = fakeApi({ text: (input, n) => delimited(input.map((o) => ({
        i: o.i, label: `T:${o.label}`, prompt: o.label === 'Quiz Game' ? o.prompt : `T:${o.prompt}`,
    }))) });
    const t = make(api);
    const out = await t.localize(ITEMS, 'zh');
    assert.deepEqual(out, [{ label: 'T:Task Manager', prompt: `T:${ITEMS[0].prompt}` }, ITEMS[1]]);
    assert.equal(api.calls.length, 2); // one try plus one retry for the English-prompt item only
    assert.deepEqual(inputOf(api.calls[1]).map((o) => o.label), ['Quiz Game']);
    await t.localize(ITEMS, 'zh');
    assert.equal(api.calls.length, 2); // not hammered again right away
});

test('a prompt that is English on the first try and translated on the retry is used', async () => {
    const api = fakeApi({ text: (input, n) => delimited(input.map((o) => ({ i: o.i, label: `T:${o.label}`, prompt: n === 0 ? o.prompt : `T:${o.prompt}` }))) });
    const out = await make(api).localize(ITEMS, 'zh');
    assert.deepEqual(out, ITEMS.map((s) => ({ label: `T:${s.label}`, prompt: `T:${s.prompt}` })));
});
