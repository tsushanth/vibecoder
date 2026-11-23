import '../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from '../helpers/http.mjs';
import { fakeApi, fakeDb, fakeEvents, msg, cb } from '../helpers/telegramFakes.mjs';
const { createBot } = await import('../../lib/telegram/bot.js');
const { createLinkService } = await import('../../lib/telegramLink.js');
const { createTelegramRouter, defaultBotFactory } = await import('../../routes/telegram.routes.js');
const { STRINGS } = await import('../../lib/telegram/strings.js');

const PREVIEW = 'https://prev-abc12345.vibebuild.cc';
const IDEAS = [{ label: 'Todo', prompt: 'Build a todo app' }, { label: 'Quiz', prompt: 'Build a quiz game' }, { label: 'Blog', prompt: 'Build a blog' }];

/** A bot wired to fakes. `script` is the sequence of progress payloads the pipeline reports for a build. */
function setup({ hold = false, script = [{ status: 'building', phase: 'generate', percent: 10 }, { status: 'building', phase: 'verify', percent: 80 }, { status: 'ready' }], start, config = {}, db = fakeDb(), suggestions = IDEAS } = {}) {
    let clock = 1_000_000;
    const api = fakeApi(); const events = fakeEvents(); const started = [];
    let i = 0; const waiters = [];
    const builds = {
        start: start || (async (args) => { started.push(args); db.tables.projects.push({ id: `p${started.length}`, creator_id: args.userId, title: 'Todo Pro', status: 'building', preview_url: null }); return { ok: true, projectId: `p${started.length}` }; }),
        progress: async () => script[Math.min(i++, script.length - 1)],
    };
    if (start) builds.start = async (a) => { started.push(a); return start(a); };
    const link = createLinkService({ supabase: db, now: () => clock });
    const bot = createBot({
        api, db, link, builds, suggestions: { fetch: async () => suggestions }, events,
        config: { pollMs: 1000, editMinMs: 0, previewWaitMs: 5000, ...config },
        now: () => clock,
        sleep: async (ms) => { if (hold) { await new Promise((r) => waiters.push(r)); } clock += ms; const p = db.tables.projects.find((x) => x.status === 'building' && i >= script.length - 1); if (p && script.at(-1).status === 'ready') { p.status = 'ready'; p.preview_url = PREVIEW; } },
        log: { warn() {} },
    });
    return { bot, api, db, events, started, link, release: () => waiters.splice(0).forEach((r) => r()), tick: (ms) => { clock += ms; }, clock: () => clock };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

// ---------------------------------------------------------------- webhook route
test('webhook fails closed: 503 without a bot or without a secret', async () => {
    for (const extra of [{ botFactory: null, webhookSecret: 'x'.repeat(20) }, { botFactory: () => ({ handleUpdate() {} }), webhookSecret: '' }]) {
        const app = express(); app.use(express.json()); app.use('/t', createTelegramRouter({ workerSecret: 'w', ...extra }));
        const s = await listen(app);
        const r = await fetch(`${s.base}/t/webhook/anything`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(r.status, 503); await s.close();
    }
});

test('defaultBotFactory needs BOTH a token and a 16+ character secret', () => {
    assert.equal(defaultBotFactory({}), null);
    assert.equal(defaultBotFactory({ TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJ' }), null);
    assert.equal(defaultBotFactory({ TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJ', TELEGRAM_WEBHOOK_SECRET: 'short' }), null);
    assert.equal(typeof defaultBotFactory({ TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJ', TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(20), NODE_ENV: 'test' }), 'function');
});

test('webhook auth: path secret AND header must match; the work is done after the 200', async () => {
    const SECRET = 'whsec_0123456789abcdef';
    const got = [];
    const app = express(); app.use(express.json());
    app.use('/t', createTelegramRouter({ workerSecret: 'w', webhookSecret: SECRET, botFactory: () => ({ handleUpdate: async (u) => { await new Promise((r) => setTimeout(r, 30)); got.push(u); } }) }));
    const s = await listen(app);
    const post = (path, headers = {}) => fetch(`${s.base}/t/webhook/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ update_id: 1 }) });
    assert.equal((await post(SECRET)).status, 401, 'no header');
    assert.equal((await post(SECRET, { 'x-telegram-bot-api-secret-token': 'wrong' })).status, 401, 'wrong header');
    assert.equal((await post('wrong', { 'x-telegram-bot-api-secret-token': SECRET })).status, 401, 'wrong path');
    assert.equal((await post(SECRET + 'x', { 'x-telegram-bot-api-secret-token': SECRET })).status, 401, 'longer path');
    assert.deepEqual(got, []);
    const t0 = Date.now();
    const ok = await post(SECRET, { 'x-telegram-bot-api-secret-token': SECRET });
    assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { ok: true });
    assert.ok(Date.now() - t0 < 25, 'replied before the handler finished');
    assert.deepEqual(got, []); await new Promise((r) => setTimeout(r, 80)); assert.deepEqual(got, [{ update_id: 1 }]);
    await s.close();
});

// ---------------------------------------------------------------- dedupe, language
test('a redelivered update_id is handled once (memory and database)', async () => {
    const t = setup(); const u = msg('/help');
    await t.bot.handleUpdate(u); await t.bot.handleUpdate(u);
    assert.equal(t.api.sent().length, 1);
    // another process, same database: the unique update_id row catches it
    const t2 = setup({ db: t.db }); assert.deepEqual(await t2.bot.handleUpdate(u), { handled: false, reason: 'duplicate' });
    assert.equal(t2.api.sent().length, 0);
});

test('language comes from Telegram language_code, falls back to English, and /language overrides and persists', async () => {
    const t = setup();
    await t.bot.handleUpdate(msg('/help', { id: 1, lang: 'pt-BR' }));
    assert.match(t.api.last().text, /seus apps/);
    await t.bot.handleUpdate(msg('/help', { id: 2, lang: 'xx' }));
    assert.match(t.api.last().text, /your apps/);
    await t.bot.handleUpdate(msg('/help', { id: 3, lang: 'zh-hans' }));
    assert.match(t.api.last().text, /你的应用/);
    await t.bot.handleUpdate(msg('/language', { id: 1, lang: 'pt-BR' }));
    const kb = t.api.last().extra.reply_markup.inline_keyboard.flat();
    assert.equal(kb.length, 27); assert.ok(kb.some((b) => b.callback_data === 'l:ja' && b.text === '日本語'));
    await t.bot.handleUpdate(cb('l:ja', { id: 1, lang: 'pt-BR' }));
    assert.equal(t.db.tables.telegram_chats.get('1').language, 'ja'); assert.equal(t.db.tables.telegram_chats.get('1').language_chosen, true);
    assert.equal(t.api.edits().at(-1).text, STRINGS.ja.langSet);
    await t.bot.handleUpdate(msg('/help', { id: 1, lang: 'pt-BR' }));
    assert.match(t.api.last().text, /アプリ/, 'the chosen language wins over language_code from now on');
    assert.ok(t.events.names().includes('language_changed'));
    await t.bot.handleUpdate(cb('l:zz', { id: 1 })); // not a language: ignored
    assert.equal(t.db.tables.telegram_chats.get('1').language, 'ja');
});

test('/start greets in the language, offers localized idea buttons, and a tap builds that idea', async () => {
    const t = setup();
    await t.bot.handleUpdate(msg('/start app', { lang: 'de', first: 'Ann' }));
    const m = t.api.last();
    assert.match(m.text, /Hallo Ann/);
    const kb = m.extra.reply_markup.inline_keyboard;
    assert.deepEqual(kb.map((r) => r[0].text), ['Todo', 'Quiz', 'Blog']);
    assert.ok(t.events.list.some((e) => e.event === 'start' && e.props.start_payload === 'app' && e.props.new_chat === true));
    assert.equal(t.db.tables.telegram_chats.get('42').start_payload, 'app');
    await t.bot.handleUpdate(cb('i:1', { lang: 'de' })); await settle();
    assert.equal(t.started[0].prompt, 'Build a quiz game');
    assert.ok(t.events.names().includes('idea_picked'));
});

test('a tap on an idea after the offer expired says so', async () => {
    const t = setup(); await t.bot.handleUpdate(cb('i:0'));
    assert.equal(t.api.last().text, STRINGS.en.ideasExpired);
});

// ---------------------------------------------------------------- build flow
test('happy path: confirm, localized phase progress edits, then the preview link in a new message; events recorded', async () => {
    const t = setup();
    await t.bot.handleUpdate(msg('a habit tracker with <b>streaks</b> & charts', { lang: 'es' }));
    await settle();
    const confirm = t.api.sent()[0];
    assert.match(confirm.text, /Creando: a habit tracker with &lt;b&gt;streaks&lt;\/b&gt; &amp; charts/, 'user text is HTML-escaped');
    assert.equal(t.started[0].userId, 'tg_42'); assert.equal(t.started[0].prompt, 'a habit tracker with <b>streaks</b> & charts');
    assert.ok(t.db.tables.users.some((u) => u.user_id === 'tg_42' && !u.telegram_id), 'the anonymous identity has a users row (projects.creator_id references it) and no telegram_id');
    const progress = t.api.edits().map((e) => e.text);
    assert.ok(progress.some((x) => x.includes('Generar') && x.includes('10%')), 'Spanish phase names from the app strings');
    assert.ok(progress.some((x) => x.includes('Verificar') && x.includes('80%')));
    const done = t.api.last();
    assert.match(done.text, /Tu app está lista/); assert.ok(done.text.includes(PREVIEW));
    const urls = done.extra.reply_markup.inline_keyboard.flat().map((b) => b.url);
    assert.deepEqual(urls, [PREVIEW, 'https://vibebuild.cc/project/p1']);
    assert.deepEqual(t.events.names().filter((n) => n.startsWith('build')), ['build_queued', 'build_finished']);
    const q = t.events.list.find((e) => e.event === 'build_queued'); assert.equal(q.language, 'es'); assert.equal(q.channel, 'telegram'); assert.equal(q.projectId, 'p1');
    assert.equal(t.db.tables.telegram_chats.get('42').active_project_id, null, 'the followed build is cleared');
    assert.equal(JSON.stringify(t.events.list).includes('habit'), false, 'no prompt text in events');
});

test('failure path: a failed build edits the status message and records build_failed', async () => {
    const t = setup({ script: [{ status: 'building', phase: 'generate', percent: 5 }, { status: 'failed' }] });
    await t.bot.handleUpdate(msg('an app', { lang: 'fr' })); await settle();
    assert.equal(t.api.edits().at(-1).text, STRINGS.fr.failed);
    assert.ok(t.events.names().includes('build_failed')); assert.ok(!t.events.names().includes('build_finished'));
    await t.bot.handleUpdate(msg('another app', { lang: 'fr' })); await settle();
    assert.equal(t.started.length, 2, 'the chat is free to build again after a failure');
});

test('pipeline refusals map to messages: 429 limit, busy workers, rejected prompt, dispatch error', async () => {
    for (const [r, key, code] of [[{ ok: false, status: 429 }, 'limit', 'LIMIT'], [{ ok: false, status: 429, systemBusy: true }, 'capacity', 'BUSY'], [{ ok: false, status: 400 }, 'rejected', 'REJECTED'], [{ ok: false, status: 502 }, 'failed', 'DISPATCH']]) {
        const t = setup({ start: async () => r });
        await t.bot.handleUpdate(msg('make me an app')); await settle();
        assert.equal(t.api.edits().at(-1).text, STRINGS.en[key], key);
        assert.equal(t.events.list.find((e) => e.event === 'build_failed').props.error_code, code);
        assert.equal(t.bot._state().active, 0, 'no stuck slot');
    }
});

test('one build at a time per chat; /stop stops following it', async () => {
    const t = setup({ hold: true, script: [{ status: 'building', phase: 'generate', percent: 5 }] });
    t.bot.handleUpdate(msg('first app')); await settle();
    await t.bot.handleUpdate(msg('second app'));
    assert.equal(t.api.last().text, STRINGS.en.busy); assert.equal(t.started.length, 1);
    await t.bot.handleUpdate(msg('/stop'));
    assert.equal(t.api.edits().at(-1).text, STRINGS.en.stopped);
    assert.ok(t.events.names().includes('build_stopped'));
    await t.bot.handleUpdate(msg('/stop'));
    assert.equal(t.api.last().text, STRINGS.en.nothingToStop);
});

test('limits: unlinked chats get a daily cap (then a link nudge), hourly cap, global active cap, flood control', async () => {
    const t = setup({ config: { anonBuildsPerDay: 2 } });
    for (let n = 0; n < 2; n++) { await t.bot.handleUpdate(msg(`app number ${n}`)); await settle(); }
    await t.bot.handleUpdate(msg('app number 3')); assert.equal(t.api.last().text, STRINGS.en.anonCap);
    assert.equal(t.events.list.find((e) => e.props?.cap === 'anon_daily').event, 'rate_limited');
    assert.equal(t.started.length, 2);

    const h = setup({ config: { chatBuildsPerHour: 1 } });
    await h.bot.handleUpdate(msg('one')); await settle(); await h.bot.handleUpdate(msg('two'));
    assert.equal(h.api.last().text, STRINGS.en.limit);

    const g = setup({ hold: true, script: [{ status: 'building', phase: 'generate', percent: 5 }], config: { maxActiveBuilds: 1 } });
    g.bot.handleUpdate(msg('a', { id: 1 })); await settle();
    await g.bot.handleUpdate(msg('b', { id: 2 }));
    assert.equal(g.api.last().text, STRINGS.en.capacity);

    const f = setup({ config: { msgPerMin: 3 } });
    for (let n = 0; n < 3; n++) await f.bot.handleUpdate(msg('/help'));
    await f.bot.handleUpdate(msg('/help')); assert.equal(f.api.last().text, STRINGS.en.slow);
    const before = f.api.sent().length; await f.bot.handleUpdate(msg('/help')); assert.equal(f.api.sent().length, before, 'only one notice per minute');
});

test('a linked chat builds as its VibeBuild account and is not subject to the unlinked cap', async () => {
    const db = fakeDb({ users: [{ user_id: 'real-1', display_name: 'Ann', telegram_id: '42' }] });
    const t = setup({ db, config: { anonBuildsPerDay: 0 } });
    await t.bot.handleUpdate(msg('an app')); await settle();
    assert.equal(t.started[0].userId, 'real-1');
});

test('the build stays inside the prompt rules: very long text is refused locally, empty/non-text gets a hint', async () => {
    const t = setup();
    await t.bot.handleUpdate(msg('x'.repeat(2001))); assert.equal(t.api.last().text, STRINGS.en.tooLong);
    await t.bot.handleUpdate({ update_id: 5001, message: { message_id: 1, from: { id: 42, is_bot: false, first_name: 'A' }, chat: { id: 42, type: 'private' }, photo: [{}] } });
    assert.equal(t.api.last().text, STRINGS.en.textOnly);
    assert.equal(t.started.length, 0);
});

test('groups get a private-chat hint, commands for another bot are ignored, bots and unknown update kinds are ignored', async () => {
    const t = setup();
    await t.bot.handleUpdate(msg('hello', { type: 'group' })); assert.equal(t.api.last().text, STRINGS.en.privateOnly);
    const n = t.api.sent().length;
    await t.bot.handleUpdate(msg('/start@some_other_bot')); assert.equal(t.api.sent().length, n);
    assert.deepEqual(await t.bot.handleUpdate({ update_id: 9001, edited_message: {} }), { handled: false, reason: 'ignored' });
    assert.deepEqual(await t.bot.handleUpdate({ update_id: 'x' }), { handled: false, reason: 'invalid' });
});

test('/apps lists the chat\'s projects (escaped) and says so when there are none', async () => {
    const db = fakeDb({ projects: [{ id: 'a', creator_id: 'tg_42', title: 'My <app>', status: 'ready', preview_url: PREVIEW }, { id: 'b', creator_id: 'tg_42', title: 'Broken', status: 'failed', preview_url: null }] });
    const t = setup({ db });
    await t.bot.handleUpdate(msg('/apps'));
    const text = t.api.last().text;
    assert.match(text, /My &lt;app&gt;/); assert.ok(text.includes(`href="${PREVIEW}"`)); assert.ok(text.includes('❌'));
    const e = setup(); await e.bot.handleUpdate(msg('/apps')); assert.equal(e.api.last().text, STRINGS.en.appsEmpty);
});

// ---------------------------------------------------------------- linking
test('link flow: deep link /start link_CODE attaches the chat to the account and moves earlier anonymous builds', async () => {
    const db = fakeDb({ users: [{ user_id: 'real-1', display_name: 'Ann Real', telegram_id: null }], projects: [{ id: 'old', creator_id: 'tg_42', title: 'Old', status: 'ready' }] });
    const t = setup({ db });
    await t.bot.handleUpdate(msg('/link'));
    const btn = t.api.last().extra.reply_markup.inline_keyboard[0][0];
    assert.equal(btn.url, 'https://vibebuild.cc/connect?tg_id=42&src=tg');
    const m = t.link.mint('real-1', '1.1.1.1'); assert.ok(m.ok);
    await t.bot.handleUpdate(msg(`/start link_${m.code}`));
    assert.match(t.api.last().text, /Connected! Welcome, Ann Real/);
    assert.equal(db.tables.users.find((u) => u.user_id === 'real-1').telegram_id, '42');
    assert.equal(db.tables.projects[0].creator_id, 'real-1');
    assert.ok(t.events.names().includes('link_done'));
    assert.equal((await t.link.consume({ code: m.code, key: 'k', telegramId: 1 })).status, 404, 'single use');
    await t.bot.handleUpdate(msg('/link')); assert.match(t.api.last().text, /already connected: Ann Real/);
});

test('link flow: a pasted 6-character code works, a bad code is refused, repeated bad codes are limited', async () => {
    const db = fakeDb({ users: [{ user_id: 'real-1', display_name: 'Ann' }] });
    const t = setup({ db });
    const m = t.link.mint('real-1', '2.2.2.2');
    await t.bot.handleUpdate(msg(m.code.toLowerCase())); assert.match(t.api.last().text, /Connected!/);
    await t.bot.handleUpdate(msg('ABCDEF')); assert.equal(t.api.last().text, STRINGS.en.linkBad);
    assert.ok(t.events.names().includes('link_failed'));
    const lim = setup({ config: { msgPerMin: 100 } });
    for (let n = 0; n < 10; n++) await lim.bot.handleUpdate(msg('ABCDE' + n));
    await lim.bot.handleUpdate(msg('ABCDEF')); assert.equal(lim.api.last().text, STRINGS.en.slow, 'per-chat failure limit');
});

// ---------------------------------------------------------------- restart
test('after a restart, resumeActive() follows the build again and still delivers the link', async () => {
    const db = fakeDb({ projects: [{ id: 'p9', creator_id: 'tg_42', title: 'Resumed', status: 'building', preview_url: null }] });
    const t0 = setup({ db });
    db.tables.telegram_chats.set('42', { telegram_id: '42', language: 'it', anon_user_id: 'tg_42', active_project_id: 'p9', active_message_id: 55, active_started_at: new Date(t0.clock()).toISOString() });
    const t = setup({ db, script: [{ status: 'building', phase: 'fix', percent: 50 }, { status: 'ready' }] });
    assert.equal(await t.bot.resumeActive(), 1); await settle();
    assert.equal(t.api.last().chatId, '42'); assert.match(t.api.last().text, /La tua app è pronta/);
});
