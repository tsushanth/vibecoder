import { reportFailure } from './failureReporter.js';

/**
 * POSTs a build result to the API. A non-2xx answer (secret mismatch, API down mid-deploy) used to count as "sent" and the
 * project then sat in 'building' until the cleanup cron failed it. Resolves true on 2xx; otherwise reports once and resolves false.
 */
export async function deliverCallback(url, payload, timeoutMs, outcome, { fetchImpl = fetch, report = reportFailure } = {}) {
    try {
        const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
        if (r.ok) return true;
        report('worker:callback_failed', new Error('build result callback rejected by the API'), { http_status: String(r.status), outcome });
    } catch (e) {
        report('worker:callback_failed', new Error('build result callback could not reach the API'), { error_name: String(e?.name || 'Error').slice(0, 40), outcome });
    }
    return false;
}
