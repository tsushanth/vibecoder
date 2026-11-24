// The Telegram bot: a thin client of the same generation pipeline the apps use.
//
//   webhook update -> handleUpdate() -> (commands | free text) -> builds.start()  == POST /api/projects/generate (same limits,
//   same prompt guard, same fair-use caps, same worker) -> poll builds.progress() == GET /api/projects/:id/progress -> edit the
//   status message with localized phase progress -> send the live preview link.
//
// Everything outside this file is injected (Telegram API, database, build pipeline, suggestions, events), so the whole flow is
// testable with no network. Nothing here stores message text: prompts go to the pipeline and are never written to the bot tables.
import { createWindowLimiter } from '../rateWindow.js';
import { promptLengthBucket } from '../appEvents.js';
import { escapeHtml, cleanText, truncate, clampMessage, t, tPlain, progressBar, languageFromCode } from './format.js';
import { STRINGS, LANGUAGES, NATIVE_NAMES } from './strings.js';

export const PHASES = Object.freeze(['generate', 'validate', 'fix', 'polish', 'verify', 'package']);
const PHASE_KEY = { generate: 'generate', validate: 'validate', fix: 'fix', polish: 'polish', verify: 'verify', package: 'pkg' };

const HEX_CODE = /^[A-Fa-f0-9]{6}$/;
const MAX_PROMPT = 2000;
const DAY = 24 * 60 * 60 * 1000;
const START_PAYLOAD = (p) => {
    if (!p) return 'none';
    if (p === 'app' || p === 'app_card' || p === 'app_build' || p === 'app_settings' || p === 'web' || p === 'web_home' || p === 'web_connect') return p;
    if (/^link_/i.test(p)) return 'link';
    return 'other';
};

export const DEFAULT_CONFIG = Object.freeze({
    botUsername: 'Vibebuilder_bot',
    webBase: 'https://vibebuild.cc',
    pollMs: 5000,                 // progress poll interval
    editMinMs: 2500,              // never edit the status message more often than this
    maxWaitMs: 12 * 60 * 1000,    // stop following a build after this long (it may still finish; /apps shows it)
    previewWaitMs: 45_000,        // ready -> preview_url is set a little later by the deploy step
    msgPerMin: 20,                // incoming messages per chat per minute
    chatBuildsPerHour: 8,         // builds per chat per hour (the server's own per-user limit still applies on top)
    anonBuildsPerDay: 3,          // builds per UNLINKED chat per day; linking an account lifts this to the server's fair-use cap
    anonBuildsGlobalPerDay: 300,  // circuit breaker: unlinked builds across all chats per day
    maxActiveBuilds: 12,          // builds followed at once by this process
    ideas: 3,
    chatCacheMs: 10 * 60 * 1000,
    userCacheMs: 60 * 1000,
    pruneEveryMs: 6 * 60 * 60 * 1000,
    resumeWindowMs: 15 * 60 * 1000,
});

/**
 * @param {object} deps
 * @param {ReturnType<import('./api.js').createTelegramApi>} deps.api
 * @param {any} deps.db supabase client
 * @param {ReturnType<import('../telegramLink.js').createLinkService>} deps.link
 * @param {{ start: Function, progress: Function }} deps.builds
 * @param {{ fetch: Function }} deps.suggestions
 * @param {{ emit: Function }} deps.events
 */
export function createBot({ api, db, link, builds, suggestions, events, config = {}, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console }) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const seen = new Map();            // update_id -> ts
    const chats = new Map();           // telegram id -> { row, at }
    const userCache = new Map();       // telegram id -> { value, at }
    const active = new Map();          // telegram id -> { projectId, messageId, startedAt, cancelled, lang }
    const ideas = new Map();           // telegram id -> { items, at }
    const floodNotified = new Map();   // telegram id -> ts

    const msgs = createWindowLimiter({ windowMs: 60_000, max: cfg.msgPerMin, now });
    const hourly = createWindowLimiter({ windowMs: 60 * 60 * 1000, max: cfg.chatBuildsPerHour, now });
    const anonDaily = createWindowLimiter({ windowMs: DAY, max: cfg.anonBuildsPerDay, now });
    const anonGlobal = createWindowLimiter({ windowMs: DAY, max: cfg.anonBuildsGlobalPerDay, maxKeys: 1, now });
    let lastPrune = now();

    const safe = async (fn, fallback = null) => { try { return await fn(); } catch (e) { log.warn?.(`[telegram-bot] ${e?.name || 'error'}: ${String(e?.message || '').replace(/bot\d+:[\w-]+/g, 'bot***').slice(0, 120)}`); return fallback; } };
    const send = (chatId, text, extra) => safe(() => api.sendMessage(chatId, clampMessage(text), extra));
    const edit = (chatId, messageId, text, extra) => safe(() => api.editMessageText(chatId, messageId, clampMessage(text), extra));

    // ---------------------------------------------------------------- chats and identity
    async function loadChat(from) {
        const id = String(from.id);
        const hit = chats.get(id);
        if (hit && now() - hit.at < cfg.chatCacheMs) return hit.row;
        let row = null;
        const { data, error } = await safe(() => db.from('telegram_chats').select('*').eq('telegram_id', id).maybeSingle(), { data: null, error: { code: 'x' } });
        if (!error && data) row = data;
        if (!row) {
            row = {
                telegram_id: id, language: languageFromCode(from.language_code), language_chosen: false, anon_user_id: `tg_${id}`,
                display_name: truncate(cleanText([from.first_name, from.last_name].filter(Boolean).join(' ')), 60) || null,
                username: from.username ? String(from.username).slice(0, 64) : null, start_payload: null, _new: true,
            };
            await safe(() => db.from('telegram_chats').insert({ telegram_id: id, language: row.language, anon_user_id: row.anon_user_id, display_name: row.display_name, username: row.username }));
        }
        if (!LANGUAGES.includes(row.language)) row.language = 'en';
        chats.set(id, { row, at: now() });
        return row;
    }
    const patchChat = (chat, patch) => {
        Object.assign(chat, patch);
        const { _new, ...clean } = patch;
        return safe(() => db.from('telegram_chats').update({ ...clean, updated_at: new Date(now()).toISOString() }).eq('telegram_id', chat.telegram_id));
    };

    /** The account this chat builds as: its linked VibeBuild account, else its own anonymous id. */
    async function resolveUser(chat) {
        const cached = userCache.get(chat.telegram_id);
        if (cached && now() - cached.at < cfg.userCacheMs) return cached.value;
        const { data } = await safe(() => db.from('users').select('user_id, display_name, subscription_tier').eq('telegram_id', chat.telegram_id).maybeSingle(), { data: null });
        const value = data?.user_id
            ? { userId: data.user_id, displayName: data.display_name || chat.display_name || 'Builder', linked: true }
            : { userId: chat.anon_user_id || `tg_${chat.telegram_id}`, displayName: chat.display_name || 'Telegram user', linked: false };
        userCache.set(chat.telegram_id, { value, at: now() });
        return value;
    }

    // projects.creator_id references users(user_id), so the anonymous identity needs a users row before its first build.
    async function ensureAnonUser(chat, user) {
        if (user.linked || chat._anonReady) return true;
        const { error } = await safe(() => db.from('users').upsert({ user_id: user.userId, display_name: truncate(user.displayName, 100), email: null, updated_at: new Date(now()).toISOString() }, { onConflict: 'user_id' }), { error: { code: 'x' } });
        if (!error) chat._anonReady = true;
        return !error;
    }

    const ev = (event, chat, extra = {}) => events.emit(event, { channel: 'telegram', chatId: chat.telegram_id, language: chat.language, ...extra });

    // ---------------------------------------------------------------- update entry point
    async function handleUpdate(update) {
        try {
            const id = update?.update_id;
            if (!Number.isSafeInteger(id)) return { handled: false, reason: 'invalid' };
            if (seen.has(id)) return { handled: false, reason: 'duplicate' };
            seen.set(id, now());
            if (seen.size > 5000) for (const k of [...seen.keys()].slice(0, 1000)) seen.delete(k);
            if (!(await firstDelivery(id))) return { handled: false, reason: 'duplicate' };

            if (update.my_chat_member) { onMyChatMember(update.my_chat_member); return { handled: true }; }
            if (update.callback_query) { await onCallback(update.callback_query); return { handled: true }; }
            const m = update.message;
            if (m && m.from && !m.from.is_bot && m.chat) { await onMessage(m); return { handled: true }; }
            return { handled: false, reason: 'ignored' };
        } catch (e) {
            log.warn?.(`[telegram-bot] update failed: ${e?.name || 'error'}`);
            try {
                const ref = update?.message?.chat?.id ?? update?.callback_query?.from?.id;
                if (ref !== undefined && ref !== null) events.emit('bot_error', { channel: 'telegram', chatId: ref, language: chats.get(String(ref))?.row?.language, props: { error_code: 'HANDLER' } });
            } catch { /* metrics only */ }
            return { handled: false, reason: 'error' };
        }
    }

    /** The person blocked or unblocked the bot (private chats only). Metrics only: no chat row is created or changed. */
    function onMyChatMember(u) {
        try {
            if (u?.chat?.type !== 'private' || !u.new_chat_member) return;
            const status = u.new_chat_member.status;
            const event = status === 'kicked' ? 'bot_blocked' : (status === 'member' && u.old_chat_member?.status === 'kicked') ? 'bot_unblocked' : null;
            if (event) events.emit(event, { channel: 'telegram', chatId: u.chat.id, language: chats.get(String(u.chat.id))?.row?.language });
        } catch { /* metrics only */ }
    }

    async function firstDelivery(id) {
        if (now() - lastPrune > cfg.pruneEveryMs) {
            lastPrune = now();
            safe(() => db.from('telegram_updates').delete().lt('received_at', new Date(now() - 3 * DAY).toISOString()));
        }
        const { error } = await safe(() => db.from('telegram_updates').insert({ update_id: id }), { error: null });
        return !(error && error.code === '23505'); // any other failure (table missing, timeout) fails open: the in-memory check already ran
    }

    async function floodOk(chatId) {
        if (msgs.hit(String(chatId))) return true;
        const last = floodNotified.get(String(chatId)) || 0;
        if (now() - last > 60_000) { floodNotified.set(String(chatId), now()); return 'notify'; }
        return false;
    }

    async function onMessage(m) {
        const chat = await loadChat(m.from);
        const flood = await floodOk(m.chat.id);
        if (flood !== true) {
            ev('rate_limited', chat, { props: { cap: 'chat_flood' } });
            if (flood === 'notify') await send(m.chat.id, t(chat.language, 'slow'));
            return;
        }
        const isNew = !!chat._new; delete chat._new;
        const text = typeof m.text === 'string' ? cleanText(m.text) : '';
        const cmd = text.startsWith('/') ? parseCommand(text) : null;
        ev('update_received', chat, { props: { command: cmd ? (['start', 'apps', 'language', 'link', 'stop', 'help'].includes(cmd.name) ? cmd.name : 'unknown') : (text ? 'text' : 'unknown'), new_chat: isNew } });

        if (m.chat.type !== 'private') { await send(m.chat.id, t(chat.language, 'privateOnly')); return; }
        if (cmd && cmd.foreign) return; // addressed to another bot
        if (cmd) return runCommand(chat, m, cmd, isNew);
        if (!text) { ev('unsupported_message', chat); await send(m.chat.id, t(chat.language, 'textOnly')); return; }
        if (HEX_CODE.test(text)) return doLink(chat, m.from, text);
        return startBuild(chat, m.from, text, 'text');
    }

    function parseCommand(text) {
        const mm = /^\/([A-Za-z_]{1,32})(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(text);
        if (!mm) return { name: 'unknown', arg: '' };
        const target = mm[2];
        return { name: mm[1].toLowerCase(), arg: (mm[3] || '').trim(), foreign: !!target && target.toLowerCase() !== cfg.botUsername.toLowerCase() };
    }

    async function runCommand(chat, m, cmd, isNew) {
        switch (cmd.name) {
            case 'start': return cmdStart(chat, m, cmd.arg, isNew);
            case 'apps': return cmdApps(chat, m);
            case 'language': return cmdLanguage(chat, m);
            case 'link': return cmdLink(chat, m, cmd.arg);
            case 'stop': return cmdStop(chat, m);
            case 'help': ev('help', chat); return send(m.chat.id, t(chat.language, 'help'));
            default: return send(m.chat.id, t(chat.language, 'help'));
        }
    }

    // ---------------------------------------------------------------- commands
    async function cmdStart(chat, m, payload, isNew) {
        const bucket = START_PAYLOAD(payload);
        if (!chat.start_payload) patchChat(chat, { start_payload: bucket });
        ev('start', chat, { props: { start_payload: bucket, new_chat: isNew } });
        const linkMatch = /^link_([A-Fa-f0-9]{6})$/.exec(payload || '');
        if (linkMatch) return doLink(chat, m.from, linkMatch[1]);

        safe(() => api.sendChatAction(m.chat.id));
        const name = truncate(cleanText(m.from.first_name || m.from.username || ''), 40) || '\u{1F44B}';
        let items = await safe(() => suggestions.fetch(chat.language, cfg.ideas), []);
        items = (Array.isArray(items) ? items : []).filter((i) => i && typeof i.prompt === 'string' && i.prompt.trim()).slice(0, cfg.ideas);
        if (items.length) ideas.set(chat.telegram_id, { items, at: now() });
        const reply_markup = items.length
            ? { inline_keyboard: items.map((it, i) => [{ text: truncate(cleanText(it.label || it.prompt), 56), callback_data: `i:${i}` }]) }
            : undefined;
        await send(m.chat.id, t(chat.language, 'welcome', { name }), reply_markup ? { reply_markup } : undefined);
    }

    async function cmdApps(chat, m) {
        const user = await resolveUser(chat);
        const ids = [...new Set([user.userId, chat.anon_user_id].filter(Boolean))];
        const { data } = await safe(() => db.from('projects').select('id, title, status, preview_url').in('creator_id', ids).order('created_at', { ascending: false }).limit(5), { data: [] });
        const rows = Array.isArray(data) ? data : [];
        ev('apps_listed', chat, { userId: user.userId, props: { linked: user.linked } });
        const dash = { reply_markup: { inline_keyboard: [[{ text: tPlain(chat.language, 'openApp'), url: `${cfg.webBase}/dashboard` }]] } };
        if (!rows.length) return send(m.chat.id, t(chat.language, 'appsEmpty'));
        const lines = rows.map((p, i) => {
            const title = escapeHtml(truncate(cleanText(p.title || '...'), 60));
            const icon = p.status === 'ready' ? '✅' : p.status === 'failed' ? '❌' : '⏳';
            const shown = p.status === 'ready' && /^https:\/\//.test(p.preview_url || '') ? `<a href="${escapeHtml(p.preview_url)}">${title}</a>` : title;
            return `${i + 1}. ${icon} ${shown}`;
        });
        return send(m.chat.id, `<b>${t(chat.language, 'appsTitle')}</b>\n\n${lines.join('\n')}`, dash);
    }

    async function cmdLanguage(chat, m) {
        const buttons = LANGUAGES.map((code) => ({ text: NATIVE_NAMES[code], callback_data: `l:${code}` }));
        const rows = []; for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
        return send(m.chat.id, t(chat.language, 'langPrompt'), { reply_markup: { inline_keyboard: rows } });
    }

    async function cmdLink(chat, m, arg) {
        if (arg && HEX_CODE.test(arg)) return doLink(chat, m.from, arg);
        const user = await resolveUser(chat);
        if (user.linked) return send(m.chat.id, t(chat.language, 'alreadyLinked', { name: user.displayName }));
        ev('link_started', chat);
        const url = `${cfg.webBase}/connect?tg_id=${encodeURIComponent(chat.telegram_id)}&src=tg`;
        return send(m.chat.id, t(chat.language, 'linkIntro'), { reply_markup: { inline_keyboard: [[{ text: tPlain(chat.language, 'linkButton'), url }]] } });
    }

    async function cmdStop(chat, m) {
        const a = active.get(chat.telegram_id);
        if (!a) return send(m.chat.id, t(chat.language, 'nothingToStop'));
        a.cancelled = true;
        active.delete(chat.telegram_id);
        patchChat(chat, { active_project_id: null, active_message_id: null, active_started_at: null });
        ev('build_stopped', chat, { projectId: a.projectId });
        if (a.messageId) await edit(m.chat.id, a.messageId, t(chat.language, 'stopped'));
        else await send(m.chat.id, t(chat.language, 'stopped'));
    }

    async function doLink(chat, from, code) {
        const r = await link.consume({ code, key: `tg:${chat.telegram_id}`, telegramId: chat.telegram_id, telegramUsername: from.username || null });
        if (!r.ok) {
            ev('link_failed', chat, { props: { error_code: r.status === 429 ? 'LIMIT' : 'REJECTED' } });
            return send(chat.telegram_id, t(chat.language, r.status === 429 ? 'slow' : 'linkBad'));
        }
        userCache.delete(chat.telegram_id);
        // Builds made anonymously from this chat move to the real account, so they appear in the app.
        if (chat.anon_user_id && chat.anon_user_id !== r.userId) {
            await safe(() => db.from('projects').update({ creator_id: r.userId }).eq('creator_id', chat.anon_user_id));
        }
        ev('link_done', chat, { userId: r.userId });
        return send(chat.telegram_id, t(chat.language, 'linkOk', { name: r.displayName }));
    }

    // ---------------------------------------------------------------- callbacks
    async function onCallback(cq) {
        if (!cq.from || cq.from.is_bot) return;
        const chat = await loadChat(cq.from);
        const isNew = !!chat._new; delete chat._new;
        safe(() => api.answerCallbackQuery(cq.id));
        const chatId = cq.message?.chat?.id ?? cq.from.id;
        const flood = await floodOk(chatId);
        if (flood !== true) { ev('rate_limited', chat, { props: { cap: 'chat_flood' } }); return; }
        ev('update_received', chat, { props: { command: 'callback', new_chat: isNew } });
        const data = String(cq.data || '');
        let mm;
        if ((mm = /^l:([A-Za-z]{2}(?:-[A-Za-z]{2})?)$/.exec(data)) && LANGUAGES.includes(mm[1])) {
            const from_language = chat.language;
            await patchChat(chat, { language: mm[1], language_chosen: true });
            ev('language_changed', chat, { props: { from_language } });
            const text = t(chat.language, 'langSet');
            if (cq.message?.message_id) await edit(chatId, cq.message.message_id, text); else await send(chatId, text);
            return;
        }
        if ((mm = /^i:(\d)$/.exec(data))) {
            const offered = ideas.get(chat.telegram_id);
            const item = offered && now() - offered.at < 60 * 60 * 1000 ? offered.items[Number(mm[1])] : null;
            if (!item) { await send(chatId, t(chat.language, 'ideasExpired')); return; }
            ev('idea_picked', chat, { props: { idea_index: Number(mm[1]) } });
            return startBuild(chat, cq.from, cleanText(item.prompt).slice(0, MAX_PROMPT), 'idea');
        }
    }

    // ---------------------------------------------------------------- builds
    async function startBuild(chat, from, prompt, via) {
        const chatId = chat.telegram_id;
        const lang = chat.language;
        if (prompt.length > MAX_PROMPT) return send(chatId, t(lang, 'tooLong'));
        if (active.has(chatId)) { ev('rate_limited', chat, { props: { cap: 'active_build' } }); return send(chatId, t(lang, 'busy')); }
        if (hourly.count(chatId) >= cfg.chatBuildsPerHour) { ev('rate_limited', chat, { props: { cap: 'hourly_chat' } }); return send(chatId, t(lang, 'limit')); }
        const user = await resolveUser(chat);
        if (!user.linked) {
            if (anonDaily.count(chatId) >= cfg.anonBuildsPerDay) { ev('rate_limited', chat, { userId: user.userId, props: { cap: 'anon_daily' } }); return send(chatId, t(lang, 'anonCap')); }
            if (anonGlobal.count('all') >= cfg.anonBuildsGlobalPerDay) { ev('rate_limited', chat, { userId: user.userId, props: { cap: 'anon_global_daily' } }); return send(chatId, t(lang, 'limit')); }
        }
        if (active.size >= cfg.maxActiveBuilds) { ev('rate_limited', chat, { userId: user.userId, props: { cap: 'global_active' } }); return send(chatId, escapeHtml(STRINGS[lang]?.capacity || STRINGS.en.capacity)); }

        const slot = { projectId: null, messageId: null, startedAt: now(), cancelled: false, lang };
        active.set(chatId, slot); // reserved before any await: a second message cannot start a second build
        const statusMsg = await send(chatId, t(lang, 'confirm', { prompt: truncate(prompt.replace(/\s+/g, ' '), 200) }));
        slot.messageId = statusMsg?.message_id ?? null;
        if (!statusMsg) { active.delete(chatId); return; }

        if (!(await ensureAnonUser(chat, user))) { active.delete(chatId); await edit(chatId, slot.messageId, t(lang, 'failed')); ev('build_failed', chat, { userId: user.userId, props: { error_code: 'DISPATCH' } }); return; }
        const r = await safe(() => builds.start({ prompt, userId: user.userId, userName: truncate(user.displayName, 80), lang }), { ok: false, status: 500 });
        if (!r?.ok || !r.projectId) {
            active.delete(chatId);
            const status = Number(r?.status) || 500;
            const [key, code, cap] = status === 429 ? [r?.systemBusy ? 'capacity' : 'limit', r?.systemBusy ? 'BUSY' : 'LIMIT', 'server_429'] : status === 400 ? ['rejected', 'REJECTED'] : ['failed', 'DISPATCH'];
            if (cap) ev('rate_limited', chat, { userId: user.userId, props: { cap } });
            await edit(chatId, slot.messageId, key === 'capacity' ? escapeHtml(STRINGS[lang]?.capacity || STRINGS.en.capacity) : t(lang, key));
            ev('build_failed', chat, { userId: user.userId, props: { error_code: code, prompt_length_bucket: promptLengthBucket(prompt.length) } });
            return;
        }
        slot.projectId = r.projectId;
        hourly.hit(chatId);
        if (!user.linked) { anonDaily.hit(chatId); anonGlobal.hit('all'); }
        patchChat(chat, { active_project_id: r.projectId, active_message_id: slot.messageId, active_started_at: new Date(slot.startedAt).toISOString() });
        ev('build_queued', chat, { userId: user.userId, projectId: r.projectId, props: { prompt_length_bucket: promptLengthBucket(prompt.length), linked: user.linked, command: via === 'idea' ? 'callback' : 'text' } });
        watch(chat, slot, user).catch(() => {});
    }

    function statusText(lang, phase, percent) {
        const idx = Math.max(0, PHASES.indexOf(phase));
        const lines = PHASES.map((p, i) => `${i < idx ? '✅' : i === idx ? '▶️' : '▫️'} ${escapeHtml(STRINGS[lang]?.[PHASE_KEY[p]] || STRINGS.en[PHASE_KEY[p]])}`);
        return `⚙️ <b>${escapeHtml(STRINGS[lang]?.working || STRINGS.en.working)}</b>\n\n${lines.join('\n')}\n\n${progressBar(percent)}`;
    }

    /** Follows one build to its end. Resumable: everything it needs is in `slot`, `chat` and `user`. */
    async function watch(chat, slot, user) {
        const chatId = chat.telegram_id;
        const lang = slot.lang;
        let lastText = ''; let lastEdit = 0;
        const finish = () => {
            if (active.get(chatId) === slot) active.delete(chatId);
            patchChat(chat, { active_project_id: null, active_message_id: null, active_started_at: null });
        };
        while (!slot.cancelled && now() - slot.startedAt < cfg.maxWaitMs) {
            await sleep(cfg.pollMs);
            if (slot.cancelled) return;
            const prog = await safe(() => builds.progress(slot.projectId), null);
            if (!prog) continue;
            if (prog.status === 'failed') {
                finish();
                if (slot.messageId) await edit(chatId, slot.messageId, t(lang, 'failed')); else await send(chatId, t(lang, 'failed'));
                ev('build_failed', chat, { userId: user?.userId, projectId: slot.projectId, props: { error_code: await failureCode(slot.projectId), duration_ms: now() - slot.startedAt } });
                return;
            }
            if (prog.status === 'ready') {
                finish();
                await deliver(chat, slot, user);
                return;
            }
            const text = statusText(lang, prog.phase, prog.percent);
            if (text !== lastText && now() - lastEdit >= cfg.editMinMs && slot.messageId) {
                lastText = text; lastEdit = now();
                await edit(chatId, slot.messageId, text);
            }
        }
        if (slot.cancelled) return;
        finish();
        await send(chatId, t(lang, 'slowBuild'));
    }

    async function failureCode(projectId) {
        const { data } = await safe(() => db.from('projects').select('error_reason').eq('id', projectId).maybeSingle(), { data: null });
        const reason = String(data?.error_reason || '');
        if (/DISPATCH/i.test(reason)) return 'DISPATCH';
        if (/WORKER/i.test(reason)) return 'WORKER';
        if (/TIMEOUT/i.test(reason)) return 'TIMEOUT';
        return 'UNKNOWN';
    }

    async function deliver(chat, slot, user) {
        const chatId = chat.telegram_id;
        const lang = slot.lang;
        let row = null;
        const until = now() + cfg.previewWaitMs;
        for (;;) {
            const { data } = await safe(() => db.from('projects').select('id, title, preview_url').eq('id', slot.projectId).maybeSingle(), { data: null });
            row = data;
            if (row?.preview_url || now() >= until) break;
            await sleep(Math.min(3000, cfg.pollMs));
        }
        const title = escapeHtml(truncate(cleanText(row?.title || ''), 80));
        const buttons = [];
        const preview = /^https:\/\//.test(row?.preview_url || '') ? row.preview_url : null;
        if (preview) buttons.push([{ text: tPlain(lang, 'preview'), url: preview }]);
        buttons.push([{ text: tPlain(lang, 'openApp'), url: `${cfg.webBase}/project/${encodeURIComponent(slot.projectId)}` }]);
        if (slot.messageId) await edit(chatId, slot.messageId, `✅ <b>${escapeHtml(STRINGS[lang]?.ready || STRINGS.en.ready)}</b>`);
        // A new message (not an edit) so the person's phone actually notifies them.
        await send(chatId, `\u{1F389} <b>${escapeHtml(STRINGS[lang]?.ready || STRINGS.en.ready)}</b>${title ? `\n${title}` : ''}${preview ? `\n\n${escapeHtml(preview)}` : ''}`, { reply_markup: { inline_keyboard: buttons } });
        ev('build_finished', chat, { userId: user?.userId, projectId: slot.projectId, props: { duration_ms: now() - slot.startedAt, linked: !!user?.linked } });
    }

    /** After a restart or deploy: pick up builds that were being followed, so their owners still get the link. */
    async function resumeActive() {
        const since = new Date(now() - cfg.resumeWindowMs).toISOString();
        const { data } = await safe(() => db.from('telegram_chats').select('*').not('active_project_id', 'is', null).gte('active_started_at', since), { data: [] });
        let resumed = 0;
        for (const row of Array.isArray(data) ? data : []) {
            if (active.has(row.telegram_id)) continue;
            const chat = { ...row };
            chats.set(row.telegram_id, { row: chat, at: now() });
            const slot = { projectId: row.active_project_id, messageId: row.active_message_id, startedAt: Date.parse(row.active_started_at) || now(), cancelled: false, lang: LANGUAGES.includes(row.language) ? row.language : 'en' };
            active.set(row.telegram_id, slot);
            resolveUser(chat).then((user) => watch(chat, slot, user)).catch(() => {});
            resumed++;
        }
        return resumed;
    }

    return { handleUpdate, resumeActive, _state: () => ({ active: active.size, chats: chats.size, seen: seen.size }) };
}
