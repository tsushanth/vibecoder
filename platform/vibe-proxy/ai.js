// vibe.ai: lets a generated app call a platform-chosen model with no key. The platform key, model choice,
// size caps and spend are controlled here; the app only supplies messages.
const DEFAULTS = {
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-5.6-luna'],
    defaultModel: 'openai/gpt-5.6-luna',
    maxOutputTokens: 800,
    maxInputChars: 8000,
    maxMessages: 20,
    timeoutMs: 30_000,
    minChargeMicros: 200, // charged when the provider reports no cost, so the cap still binds
};
const ROLES = new Set(['system', 'user', 'assistant']);
const DENY_STATUS = { app_disabled: 403, limiter_unavailable: 503, bad_request: 400 };
const json = { 'content-type': 'application/json' };
const out = (status, obj, headers = {}) => ({ status, headers: { ...json, ...headers }, body: JSON.stringify(obj) });
const fail = (status, error) => out(status, { error });

export async function aiChat({ req, appId, ip, apiKey, fetchImpl, limiter, meter, config = {} }) {
    const cfg = { ...DEFAULTS, ...config };
    const t0 = meter.now();
    const done = async (res, outcome, requestBytes = 0) => {
        await meter.record({ appId, connector: 'ai', status: res.status, outcome, requestBytes, responseBytes: res.body.length, ms: meter.now() - t0 });
        return res;
    };
    const msgs = req?.messages;
    if (!Array.isArray(msgs) || !msgs.length || msgs.length > cfg.maxMessages || msgs.some((m) => !m || !ROLES.has(m.role) || typeof m.content !== 'string')) return done(fail(400, 'bad_request'), 'bad_request');
    const chars = msgs.reduce((n, m) => n + m.content.length, 0);
    if (chars > cfg.maxInputChars) return done(fail(413, 'request_too_large'), 'request_too_large', chars);
    if (!apiKey) return done(fail(503, 'ai_unavailable'), 'ai_unavailable', chars);

    const chk = await limiter.check({ appId, ip });
    if (!chk.ok) {
        const status = DENY_STATUS[chk.reason] || 429;
        return done(out(status, { error: chk.reason }, chk.retryAfterSec > 0 ? { 'retry-after': String(chk.retryAfterSec) } : {}), chk.reason, chars);
    }

    const model = cfg.models.includes(req.model) ? req.model : cfg.defaultModel;
    const maxTokens = Math.min(Number.isFinite(req.maxTokens) && req.maxTokens > 0 ? Math.floor(req.maxTokens) : cfg.maxOutputTokens, cfg.maxOutputTokens);
    const temperature = Math.min(Math.max(Number.isFinite(req.temperature) ? req.temperature : 0.7, 0), 1.2);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
        const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: msgs.map((m) => ({ role: m.role, content: m.content })), max_tokens: maxTokens, temperature, usage: { include: true } }),
            redirect: 'manual',
            signal: ctrl.signal,
        });
        const raw = await res.text();
        if (!res.ok) return done(fail(502, 'upstream_error'), 'upstream_error', chars);
        let j;
        try { j = JSON.parse(raw); } catch { return done(fail(502, 'upstream_error'), 'upstream_error', chars); }
        const cost = Number(j?.usage?.cost);
        await limiter.recordSpend({ appId, micros: Number.isFinite(cost) && cost > 0 ? Math.round(cost * 1e6) : cfg.minChargeMicros });
        const text = j?.choices?.[0]?.message?.content;
        if (!text) return done(fail(502, 'empty_reply'), 'empty_reply', chars);
        return done(out(200, { text, usage: { promptTokens: j.usage?.prompt_tokens ?? 0, completionTokens: j.usage?.completion_tokens ?? 0 } }), 'ok', chars);
    } catch (e) {
        return e?.name === 'AbortError' ? done(fail(504, 'upstream_timeout'), 'upstream_timeout', chars) : done(fail(502, 'upstream_error'), 'upstream_error', chars);
    } finally {
        clearTimeout(timer);
    }
}
