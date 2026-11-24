import '../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { STRINGS, LANGUAGES, KEYS, NATIVE_NAMES } = await import('../../lib/telegram/strings.js');
const { escapeHtml, clampMessage, truncate, t, languageFromCode, progressBar, cleanText } = await import('../../lib/telegram/format.js');
const { createTelegramApi, TelegramError } = await import('../../lib/telegram/api.js');
const { buildRow, cleanProps, chatRef, createChannelEvents } = await import('../../lib/telegram/metrics.js');
const { createLoopbackBuilds, createLoopbackSuggestions } = await import('../../lib/telegram/pipeline.js');
const { channelFromRequest } = await import('../../lib/appEvents.js');
const { SUPPORTED_LANGS } = await import('../../lib/suggestionI18n.js');

test('strings: English plus every app language, every key, placeholders preserved', () => {
    assert.equal(LANGUAGES.length, 29);
    const appLangs = new Set(['en', ...SUPPORTED_LANGS]);
    assert.deepEqual([...LANGUAGES].sort(), [...appLangs].sort(), 'same languages as the suggestions i18n (and so as the app)');
    for (const l of LANGUAGES) {
        assert.ok(NATIVE_NAMES[l], `native name ${l}`);
        for (const k of KEYS) assert.ok(typeof STRINGS[l][k] === 'string' && STRINGS[l][k].trim(), `${l}.${k}`);
        assert.ok(STRINGS[l].welcome.includes('{name}') && STRINGS[l].linkOk.includes('{name}') && STRINGS[l].alreadyLinked.includes('{name}') && STRINGS[l].confirm.includes('{prompt}'), `${l} placeholders`);
        for (const k of KEYS) assert.doesNotMatch(STRINGS[l][k].replace(/\{(name|prompt)\}/g, ''), /[{}<>]/, `${l}.${k} has stray markup`);
    }
});

test('strings: every command shown in help exists in every language', () => {
    for (const l of LANGUAGES) for (const c of ['/start', '/apps', '/language', '/link', '/stop', '/help']) assert.ok(STRINGS[l].help.includes(c), `${l} ${c}`);
});

test('format: escaping, truncation by code point, clamping never ends mid-entity or open tag', () => {
    assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href="x"&gt;&amp;&lt;/a&gt;');
    assert.equal(t('en', 'confirm', { prompt: '<script>' }), 'On it! Building: &lt;script&gt;\nThis takes about 2 minutes.');
    assert.equal(t('xx', 'stopped'), t('en', 'stopped'), 'unknown language falls back to English');
    assert.equal(truncate('😀😀😀😀', 3), '😀😀…');
    const long = `<b>${'&amp;'.repeat(2000)}</b>`;
    const c = clampMessage(long, 4096);
    assert.ok(c.length <= 4096 && !/&[a-z#0-9]*…$/.test(c) && c.includes('</b>'));
    assert.equal(progressBar(35), '▰▰▰▰▱▱▱▱▱▱ 35%');
    assert.equal(cleanText('a\u0000b\r\nc'), 'a b\nc');
});

test('format: Telegram language codes map to ours', () => {
    for (const [code, want] of [['pt-br', 'pt'], ['zh-hans', 'zh'], ['zh', 'zh'], ['zh-cn', 'zh'], ['zh-sg', 'zh'], ['zh-hant', 'zh-TW'], ['zh-TW', 'zh-TW'], ['zh-mo', 'zh-TW'], ['zh-hk', 'zh-HK'], ['zh-HK', 'zh-HK'], ['constructor', 'en'], ['__proto__', 'en'], ['id', 'id'], ['in', 'id'], ['fil', 'tl'], ['uk', 'uk'], ['en-GB', 'en'], ['he', 'en'], ['iw', 'en'], ['', 'en'], [undefined, 'en'], ['ja', 'ja']]) assert.equal(languageFromCode(code), want, String(code));
});

const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('api: null without a token; sends JSON to the bot URL; errors never carry the token', async () => {
    assert.equal(createTelegramApi({ token: '' }), null);
    const TOKEN = '123456:SECRET-token-value';
    const calls = [];
    const api = createTelegramApi({ token: TOKEN, fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return res({ ok: true, result: { message_id: 9 } }); } });
    assert.deepEqual(await api.sendMessage(5, 'hi'), { message_id: 9 });
    assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`); assert.equal(calls[0].body.parse_mode, 'HTML');
    const bad = createTelegramApi({ token: TOKEN, fetchImpl: async () => { throw new Error(`connect failed https://api.telegram.org/bot${TOKEN}/sendMessage`); } });
    await assert.rejects(() => bad.sendMessage(1, 'x'), (e) => e instanceof TelegramError && !String(e.message + e.stack).includes('SECRET'));
});

test('api: one retry on 429 with a short retry_after, "message is not modified" is not an error', async () => {
    let n = 0; const slept = [];
    const api = createTelegramApi({ token: '123456:abcdefgh', sleep: async (ms) => slept.push(ms), fetchImpl: async () => (++n === 1 ? res({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 2 } }, 429) : res({ ok: true, result: true })) });
    assert.equal(await api.sendChatAction(1), true); assert.deepEqual(slept, [2000]); assert.equal(n, 2);
    const long = createTelegramApi({ token: '123456:abcdefgh', sleep: async () => {}, fetchImpl: async () => res({ ok: false, error_code: 429, description: 'x', parameters: { retry_after: 60 } }, 429) });
    await assert.rejects(() => long.sendMessage(1, 'x'), (e) => e.code === 429 && e.retryAfter === 60);
    const same = createTelegramApi({ token: '123456:abcdefgh', fetchImpl: async () => res({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }, 400) });
    assert.equal(await same.editMessageText(1, 2, 'same'), null);
});

test('metrics: only allow-listed events and props; free text, names and raw ids never stored', () => {
    assert.equal(buildRow({ event: 'message_text' }), null);
    assert.equal(buildRow({ channel: 'carrier-pigeon', event: 'start' }), null);
    const row = buildRow({ event: 'build_queued', language: 'es', chatRef: chatRef('telegram', 42, 's'), userId: 'tg_42', projectId: '11111111-1111-4111-8111-111111111111', props: { prompt: 'secret idea', name: 'Ann', error_code: 'DISPATCH', prompt_length_bucket: 'lt40', cap: 'nope', duration_ms: 1234.4, linked: false } });
    assert.deepEqual(row.props, { error_code: 'DISPATCH', prompt_length_bucket: 'lt40', duration_ms: 1234, linked: false });
    assert.equal(row.chat_ref.length, 16); assert.notEqual(row.chat_ref, '42'); assert.equal(chatRef('telegram', 42, 's'), chatRef('telegram', 42, 's')); assert.notEqual(chatRef('telegram', 42, 's'), chatRef('telegram', 43, 's'));
    assert.equal(buildRow({ event: 'start', userId: 'a@b.com' }).user_id, null);
    assert.deepEqual(cleanProps(null), {});
});

test('metrics: emit writes to channel_events, never throws, backs off when the table is missing', async () => {
    const rows = []; let fail = null;
    const client = { from: (table) => ({ insert: async (r) => { if (fail) return { error: fail }; rows.push({ table, r }); return { error: null }; } }) };
    const ev = createChannelEvents({ getClient: () => client, salt: () => 's', log: { warn() {} } });
    assert.deepEqual(await ev.record('start', { chatId: 1, language: 'de', props: { start_payload: 'app' } }), { ok: true });
    assert.equal(rows[0].table, 'channel_events'); assert.equal(rows[0].r.channel, 'telegram'); assert.equal(rows[0].r.language, 'de');
    fail = { code: '42P01', message: 'relation "channel_events" does not exist' };
    assert.equal((await ev.record('start', { chatId: 1 })).ok, false);
    fail = null; assert.equal((await ev.record('start', { chatId: 1 })).reason, 'backoff');
    assert.doesNotThrow(() => ev.emit('nope', {}));
    assert.equal(createChannelEvents({ getClient: () => client, enabled: () => false }).emit('start', {}), undefined);
});

test('pipeline: generate goes through the app endpoint as source=telegram and reads the queued event', async () => {
    const seen = [];
    const sse = (lines) => new Response(lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const b = createLoopbackBuilds({ baseUrl: 'http://api.test', fetchImpl: async (url, init) => { seen.push({ url, body: init.body && JSON.parse(init.body) }); return sse([{ type: 'queued', projectId: 'pid-1' }]); } });
    assert.deepEqual(await b.start({ prompt: 'p', userId: 'tg_1', userName: 'Ann' }), { ok: true, projectId: 'pid-1' });
    assert.equal(seen[0].url, 'http://api.test/api/projects/generate');
    assert.deepEqual(seen[0].body, { prompt: 'p', userId: 'tg_1', userName: 'Ann', stream: false, source: 'telegram' });
    const refused = createLoopbackBuilds({ baseUrl: 'http://api.test', fetchImpl: async () => res({ error: 'Rate limit exceeded. Try again in an hour.' }, 429) });
    assert.deepEqual(await refused.start({ prompt: 'p', userId: 'u' }), { ok: false, status: 429, error: 'Rate limit exceeded. Try again in an hour.' });
    const busy = createLoopbackBuilds({ baseUrl: 'http://api.test', fetchImpl: async () => sse([{ type: 'queued', projectId: 'x' }, { type: 'error', error: 'busy', systemBusy: true }]) });
    assert.equal((await busy.start({ prompt: 'p', userId: 'u' })).systemBusy, true);
    const none = createLoopbackBuilds({ baseUrl: 'http://api.test', fetchImpl: async () => sse([]) });
    assert.equal((await none.start({ prompt: 'p', userId: 'u' })).ok, false);
    const pr = createLoopbackBuilds({ baseUrl: 'http://api.test', fetchImpl: async (url) => { seen.push({ url }); return res({ status: 'building', phase: 'fix', percent: 40 }); } });
    assert.equal((await pr.progress('abc', 'tg_1')).phase, 'fix'); assert.equal(seen.at(-1).url, 'http://api.test/api/projects/abc/progress?userId=tg_1');
    const s = createLoopbackSuggestions({ baseUrl: 'http://api.test', fetchImpl: async (url) => { seen.push({ url }); return res({ success: true, suggestions: [{ label: 'a', prompt: 'b' }] }); } });
    assert.equal((await s.fetch('ja', 3)).length, 1); assert.equal(seen.at(-1).url, 'http://api.test/api/projects/suggestions?count=3&lang=ja');
});

test('channelFromRequest: bots name their channel, apps send x-platform, the rest falls back to the user agent', () => {
    const r = (body, headers = {}) => ({ body, headers });
    assert.equal(channelFromRequest(r({ source: 'telegram' })), 'telegram');
    assert.equal(channelFromRequest(r({ source: 'SMS' })), 'sms');
    assert.equal(channelFromRequest(r({ source: 'whatsapp' })), 'whatsapp');
    assert.equal(channelFromRequest(r({ source: 'bogus' }, { 'x-platform': 'android' })), 'android');
    assert.equal(channelFromRequest(r({}, { 'x-platform': 'ios' })), 'ios');
    assert.equal(channelFromRequest(r({}, { 'user-agent': 'okhttp/4.12' })), 'android');
    assert.equal(channelFromRequest(r({}, { 'user-agent': 'Mozilla/5.0' })), 'web');
    assert.equal(channelFromRequest(r({})), 'api');
    assert.equal(channelFromRequest(r(undefined)), 'api');
});
