// Adapters that let the bot use the app's own endpoints without leaving the process.
//
// The bot goes through POST /api/projects/generate and GET /api/projects/:id/progress on this same server (127.0.0.1), not a
// copy of their logic: prompt guard, secret capture, hourly and fair-use limits, the worker dispatch, the progress store (which is
// in memory inside the projects router) and usage recording all stay in one place. Loopback costs no network egress.
import { signInternalAuth, INTERNAL_AUTH_HEADER } from '../internalAuth.js';

const DEFAULT_BASE = () => `http://127.0.0.1:${process.env.PORT || 8080}`;

export function createLoopbackBuilds({ baseUrl = DEFAULT_BASE, fetchImpl = (...a) => globalThis.fetch(...a), startTimeoutMs = 75_000, secret = () => process.env.WORKER_SECRET, nowMs = () => Date.now() } = {}) {
    const base = () => (typeof baseUrl === 'function' ? baseUrl() : baseUrl);
    const internalHeaders = (userId) => {
        const v = signInternalAuth(typeof secret === 'function' ? secret() : secret, userId, nowMs());
        return v ? { [INTERNAL_AUTH_HEADER]: v } : {};
    };

    /** @returns {Promise<{ok:true,projectId:string}|{ok:false,status:number,error?:string,systemBusy?:boolean}>} */
    async function start({ prompt, userId, userName }) {
        const res = await fetchImpl(`${base()}/api/projects/generate`, {
            method: 'POST',
            // The bot's userId is not backed by a token (unlinked chats use a bot-owned id), so it proves itself with the internal
            // signature (lib/internalAuth.js). No header is sent when there is no secret: the server then treats the call as public.
            headers: { 'Content-Type': 'application/json', 'x-client-platform': 'api', ...internalHeaders(userId) },
            body: JSON.stringify({ prompt, userId, userName, stream: false, source: 'telegram' }),
            signal: AbortSignal.timeout(startTimeoutMs),
        });
        if (!res.ok) {
            let j = null; try { j = await res.json(); } catch { /* not JSON */ }
            return { ok: false, status: res.status, error: typeof j?.error === 'string' ? j.error.slice(0, 200) : undefined };
        }
        // stream:false => the server writes a `queued` event (or an `error` event) and closes the response.
        const text = await res.text();
        let projectId = null; let failure = null;
        for (const line of text.split('\n')) {
            if (!line.startsWith('data:')) continue;
            let evt; try { evt = JSON.parse(line.slice(5)); } catch { continue; }
            if (evt.type === 'queued' && typeof evt.projectId === 'string') projectId = evt.projectId;
            if (evt.type === 'error') failure = evt;
        }
        if (failure) return { ok: false, status: failure.systemBusy || failure.quotaExhausted ? 429 : 502, systemBusy: !!(failure.systemBusy || failure.quotaExhausted), error: String(failure.error || '').slice(0, 200) };
        return projectId ? { ok: true, projectId } : { ok: false, status: 502 };
    }

    /** The same payload the apps poll: { status: building|ready|failed, phase, percent, ... } or null. */
    async function progress(projectId, userId) {
        const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
        const res = await fetchImpl(`${base()}/api/projects/${encodeURIComponent(projectId)}/progress${q}`, { signal: AbortSignal.timeout(10_000) });
        return res.ok ? res.json() : null;
    }

    return { start, progress };
}

/** Idea buttons come from GET /api/projects/suggestions?lang= (translated and cached by lib/suggestionI18n.js). */
export function createLoopbackSuggestions({ baseUrl = DEFAULT_BASE, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 8000 } = {}) {
    return {
        async fetch(lang, count = 3) {
            const b = typeof baseUrl === 'function' ? baseUrl() : baseUrl;
            const res = await fetchImpl(`${b}/api/projects/suggestions?count=${count}&lang=${encodeURIComponent(lang)}`, { signal: AbortSignal.timeout(timeoutMs) });
            if (!res.ok) return [];
            const j = await res.json();
            return Array.isArray(j?.suggestions) ? j.suggestions : [];
        },
    };
}
