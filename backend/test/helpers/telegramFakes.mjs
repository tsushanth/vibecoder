// In-memory stand-ins for everything the Telegram bot talks to: the Bot API, the database, the build pipeline, the event sink.
import { makeBuilder } from './supabaseStub.mjs';

export function fakeApi() {
    const calls = []; let mid = 100;
    const rec = (method) => async (...args) => { calls.push({ method, args }); return method === 'sendMessage' ? { message_id: ++mid } : true; };
    const api = {
        calls,
        sendMessage: async (chatId, text, extra) => { calls.push({ method: 'sendMessage', chatId, text, extra }); return { message_id: ++mid }; },
        editMessageText: async (chatId, messageId, text, extra) => { calls.push({ method: 'editMessageText', chatId, messageId, text, extra }); return true; },
        answerCallbackQuery: async (id) => { calls.push({ method: 'answerCallbackQuery', id }); return true; },
        sendChatAction: rec('sendChatAction'),
        sent: () => calls.filter((c) => c.method === 'sendMessage'),
        edits: () => calls.filter((c) => c.method === 'editMessageText'),
        texts: () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => c.text),
        last: () => calls.filter((c) => c.method === 'sendMessage').at(-1),
    };
    return api;
}

/** A tiny database that understands exactly the queries the bot makes. */
export function fakeDb({ users = [], projects = [] } = {}) {
    const t = { telegram_chats: new Map(), telegram_updates: new Set(), users: [...users], projects: [...projects] };
    const eq = (q, col) => q.filters.find((f) => f[0] === 'eq' && f[1] === col)?.[2];
    const inn = (q, col) => q.filters.find((f) => f[0] === 'in' && f[1] === col)?.[2];
    const handler = (q) => {
        const one = (row) => ({ data: row ?? null, error: null });
        if (q.table === 'telegram_updates') {
            if (q.op === 'insert') { if (t.telegram_updates.has(q.payload.update_id)) return { data: null, error: { code: '23505' } }; t.telegram_updates.add(q.payload.update_id); return { data: null, error: null }; }
            return { data: null, error: null };
        }
        if (q.table === 'telegram_chats') {
            if (q.op === 'insert') { t.telegram_chats.set(q.payload.telegram_id, { ...q.payload }); return { data: null, error: null }; }
            if (q.op === 'update') { const r = t.telegram_chats.get(eq(q, 'telegram_id')); if (r) Object.assign(r, q.payload); return { data: null, error: null }; }
            if (q.filters.some((f) => f[0] === 'not')) return { data: [...t.telegram_chats.values()].filter((r) => r.active_project_id), error: null };
            return one(t.telegram_chats.get(eq(q, 'telegram_id')));
        }
        if (q.table === 'users') {
            if (q.op === 'upsert') { const i = t.users.findIndex((u) => u.user_id === q.payload.user_id); if (i >= 0) Object.assign(t.users[i], q.payload); else t.users.push({ ...q.payload }); return { data: null, error: null }; }
            if (q.op === 'update') { const p = q.payload; if (p.telegram_id === null) { t.users.filter((u) => u.telegram_id === eq(q, 'telegram_id') && !q.filters.some((f) => f[0] === 'neq' && f[2] === u.user_id)).forEach((u) => { u.telegram_id = null; }); } else { const u = t.users.find((x) => x.user_id === eq(q, 'user_id')); if (u) Object.assign(u, p); } return { data: null, error: null }; }
            const tg = eq(q, 'telegram_id'); const uid = eq(q, 'user_id');
            return one(t.users.find((u) => (tg !== undefined ? u.telegram_id === tg : u.user_id === uid)));
        }
        if (q.table === 'projects') {
            if (q.op === 'update') { t.projects.filter((p) => p.creator_id === eq(q, 'creator_id')).forEach((p) => Object.assign(p, q.payload)); return { data: null, error: null }; }
            const id = eq(q, 'id'); if (id) return one(t.projects.find((p) => p.id === id));
            const ids = inn(q, 'creator_id') || [];
            return { data: t.projects.filter((p) => ids.includes(p.creator_id)).slice(0, 5), error: null };
        }
        return { data: null, error: null };
    };
    return { tables: t, from: (table) => makeBuilder(table, handler) };
}

export function fakeEvents() { const list = []; return { list, emit: (event, opts) => list.push({ event, ...opts }), names: () => list.map((e) => e.event) }; }

/** Update builders. */
let uid = 1000;
export const msg = (text, { id = 42, lang = 'en', first = 'Ann', type = 'private', extra = {} } = {}) => ({ update_id: ++uid, message: { message_id: uid, from: { id, is_bot: false, first_name: first, language_code: lang }, chat: { id, type }, text, ...extra } });
export const cb = (data, { id = 42, lang = 'en' } = {}) => ({ update_id: ++uid, callback_query: { id: `cq${uid}`, from: { id, is_bot: false, first_name: 'Ann', language_code: lang }, message: { message_id: 7, chat: { id, type: 'private' } }, data } });
