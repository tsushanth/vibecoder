// Minimal Telegram Bot API client. The bot token only ever appears in the request URL and is never logged or thrown.
//   createTelegramApi({ token }) -> { sendMessage, editMessageText, answerCallbackQuery, sendChatAction } or null when the token is unset
// `fetchImpl` is injectable so tests never touch the network.
export class TelegramError extends Error {
    constructor(code, description, retryAfter) {
        super(`telegram ${code}: ${description}`);
        this.name = 'TelegramError';
        this.code = code;
        this.description = description;
        this.retryAfter = retryAfter;
    }
}

const NOT_MODIFIED = /message is not modified/i;

export function createTelegramApi({ token, fetchImpl = (...a) => globalThis.fetch(...a), baseUrl = 'https://api.telegram.org', timeoutMs = 10_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxRetryAfterSec = 5 } = {}) {
    if (typeof token !== 'string' || token.length < 10) return null;

    async function call(method, params = {}, attempt = 0) {
        let res;
        try {
            res = await fetchImpl(`${baseUrl}/bot${token}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (e) {
            throw new TelegramError(0, e?.name === 'TimeoutError' ? 'timeout' : 'network error'); // never e.message: it can carry the URL
        }
        let body = null;
        try { body = await res.json(); } catch { /* non-JSON */ }
        if (body?.ok) return body.result;
        const code = Number(body?.error_code ?? res.status) || res.status;
        const description = String(body?.description ?? 'request failed').slice(0, 200);
        const retryAfter = Number(body?.parameters?.retry_after) || undefined;
        if (code === 429 && retryAfter && retryAfter <= maxRetryAfterSec && attempt < 1) {
            await sleep(retryAfter * 1000);
            return call(method, params, attempt + 1);
        }
        throw new TelegramError(code, description, retryAfter);
    }

    return {
        call,
        sendMessage: (chatId, text, extra = {}) => call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra }),
        /** Edits a message; "message is not modified" is not an error (returns null). */
        editMessageText: async (chatId, messageId, text, extra = {}) => {
            try { return await call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra }); }
            catch (e) { if (e instanceof TelegramError && NOT_MODIFIED.test(e.description)) return null; throw e; }
        },
        answerCallbackQuery: (id, text) => call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text: String(text).slice(0, 190) } : {}) }),
        sendChatAction: (chatId, action = 'typing') => call('sendChatAction', { chat_id: chatId, action }),
    };
}
