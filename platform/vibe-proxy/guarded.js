// handleProxy wrapped with limits, spend accounting and metering. This is what the edge function calls.
import { handleProxy } from './proxy.js';

const DENY_STATUS = { app_disabled: 403, limiter_unavailable: 503, bad_request: 400 };
const bytes = (s) => new TextEncoder().encode(String(s ?? '')).byteLength;

function outcomeOf(res) {
    if (res.status < 400) return 'ok';
    try { return JSON.parse(res.body).error || `status_${res.status}`; } catch { return `status_${res.status}`; }
}

export async function guardedProxy({ limiter, meter, appId, ip, req, manifest, secrets, fetchImpl, resolve, limits, callCostMicros = 0 }) {
    const t0 = meter.now();
    const base = { appId, connector: req?.connector };
    const chk = await limiter.check({ appId, ip });
    if (!chk.ok) {
        const status = DENY_STATUS[chk.reason] || 429;
        const headers = { 'content-type': 'application/json' };
        if (chk.retryAfterSec > 0) headers['retry-after'] = String(chk.retryAfterSec);
        await meter.record({ ...base, status, outcome: chk.reason, ms: meter.now() - t0 });
        return { status, headers, body: JSON.stringify({ error: chk.reason }) };
    }
    const res = await handleProxy({ req, manifest, secrets, fetchImpl, resolve, limits });
    if (callCostMicros > 0 && res.status >= 200 && res.status < 300) await limiter.recordSpend({ appId, micros: callCostMicros });
    await meter.record({ ...base, status: res.status, outcome: outcomeOf(res), requestBytes: bytes(req?.body === undefined ? '' : typeof req.body === 'string' ? req.body : JSON.stringify(req.body)), responseBytes: bytes(res.body), ms: meter.now() - t0 });
    return res;
}
