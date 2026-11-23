// Thin client for the VibeBuild API, the same HTTP routes the app and web use. Nothing here reaches into internals.
// Phone-to-account linking goes through /api/telegram/verify and /api/telegram/user/:id (the phone number is the id).

export class BackendUnavailable extends Error {}

export function createBackend({ apiUrl, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const base = String(apiUrl).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'vibebuild-messaging/1.0' };

  async function call(path, init = {}, ms = timeoutMs) {
    try {
      return await fetchImpl(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(ms) });
    } catch (e) {
      throw new BackendUnavailable(e?.name === 'TimeoutError' ? 'timeout' : 'network');
    }
  }
  const json = async (res) => { try { return await res.json(); } catch { return null; } };

  return {
    /** -> { linked: false } | { linked: true, userId, displayName }. Throws BackendUnavailable on 5xx/network/disabled. */
    async lookupUser(phone) {
      const res = await call(`/api/telegram/user/${encodeURIComponent(phone)}`);
      if (res.status >= 500 || res.status === 429) throw new BackendUnavailable(`status ${res.status}`);
      const data = await json(res);
      if (data?.linked && data.userId) return { linked: true, userId: data.userId, displayName: data.displayName || 'Builder' };
      return { linked: false };
    },
    /** -> { ok: true, userId, displayName } | { ok: false, reason: 'invalid' | 'expired' | 'rate_limited' }. */
    async verifyCode(code, phone) {
      const res = await call('/api/telegram/verify', { method: 'POST', body: JSON.stringify({ code: String(code).toUpperCase(), telegramId: phone, telegramUsername: null, telegramName: phone }) });
      if (res.status === 404) return { ok: false, reason: 'invalid' };
      if (res.status === 410) return { ok: false, reason: 'expired' };
      if (res.status === 429) return { ok: false, reason: 'rate_limited' };
      if (res.status >= 500) throw new BackendUnavailable(`status ${res.status}`);
      const data = await json(res);
      if (data?.success && data.userId) return { ok: true, userId: data.userId, displayName: data.displayName || 'Builder' };
      return { ok: false, reason: 'invalid' };
    },
    /**
     * Starts a build (stream:false: the API answers with one SSE "queued" event carrying projectId, then closes, and the
     * result is read by polling progress). -> { ok: true, projectId } | { ok: false, reason: 'rejected' | 'limit' | 'busy' | 'error' }.
     */
    async startBuild({ prompt, userId, source }) {
      let res;
      try {
        res = await call('/api/projects/generate', { method: 'POST', body: JSON.stringify({ prompt, userId, stream: false, source }) }, 30_000);
      } catch { return { ok: false, reason: 'error' }; }
      const type = res.headers.get('content-type') || '';
      if (!type.includes('text/event-stream')) {
        const body = await json(res);
        if (res.status === 400) return { ok: false, reason: 'rejected' };
        if (res.status === 429) return { ok: false, reason: body?.fairUse || /limit/i.test(body?.error || '') ? 'limit' : 'busy' };
        return { ok: false, reason: 'error' };
      }
      let text = '';
      try { text = await res.text(); } catch { /* fall through with what we have */ }
      let projectId = null;
      let failure = null;
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === 'queued' && ev.projectId) projectId = ev.projectId;
        if (ev.type === 'error') failure = ev;
      }
      if (projectId && !failure) return { ok: true, projectId };
      if (failure) return { ok: false, reason: failure.quotaExhausted || failure.systemBusy ? 'busy' : 'error' };
      return { ok: false, reason: 'error' };
    },
    /** -> { status: 'building' | 'ready' | 'failed', phase, percent } or { status: 'unknown' } (404 / transient). */
    async progress(projectId, userId) {
      let res;
      try { res = await call(`/api/projects/${encodeURIComponent(projectId)}/progress?userId=${encodeURIComponent(userId)}`); } catch { return { status: 'unknown' }; }
      if (res.status === 404) return { status: 'missing' };
      if (!res.ok) return { status: 'unknown' };
      const d = await json(res);
      if (!d || !['building', 'ready', 'failed'].includes(d.status)) return { status: 'unknown' };
      return { status: d.status, phase: d.phase, percent: Number(d.percent) || 0 };
    },
  };
}
