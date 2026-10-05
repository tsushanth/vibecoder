// The slice 1 proxy core: runs one declared connector call on behalf of a generated app.
// Pure of platform specifics: fetch, DNS and the secret values are injected by the edge function.
import { checkUrl } from './ssrf.js';

const DEFAULT_LIMITS = { maxRequestBytes: 100_000, maxResponseBytes: 2_000_000, timeoutMs: 15_000 };
const FORWARDED_HEADERS = new Set(['accept', 'accept-language']);
const JSON_HEADERS = { 'content-type': 'application/json' };

const fail = (status, error, message) => ({ status, headers: { ...JSON_HEADERS }, body: JSON.stringify({ error, message }) });

function pathAllowed(path, patterns) {
    if (typeof path !== 'string' || !path.startsWith('/') || /[?#\\]/.test(path) || /%2f|%5c/i.test(path) || path.includes('//')) return false;
    let segs;
    try { segs = path.split('/').map((s) => decodeURIComponent(s)); } catch { return false; }
    if (segs.some((s) => s === '..' || s === '.')) return false;
    return patterns.some((p) => (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p));
}

async function readCapped(res, max, signal) {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let total = 0;
    for (;;) {
        if (signal.aborted) { reader.cancel().catch(() => {}); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) { reader.cancel().catch(() => {}); return null; }
        chunks.push(value);
    }
    const all = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.byteLength; }
    return new TextDecoder().decode(all);
}

function redact(text, secretValue) {
    if (!secretValue || secretValue.length < 4) return text;
    let out = text.split(secretValue).join('[REDACTED]');
    const tail = secretValue.split(' ').pop();
    if (tail && tail !== secretValue && tail.length >= 4) out = out.split(tail).join('[REDACTED]');
    return out;
}

export async function handleProxy({ req, manifest, secrets = {}, fetchImpl, resolve, limits = {} }) {
    const lim = { ...DEFAULT_LIMITS, ...limits };
    const c = manifest?.connectors?.[req?.connector];
    if (!c) return fail(404, 'unknown_connector', 'No such connector in this app\'s manifest');
    const method = String(req.method || '').toUpperCase();
    if (!c.methods.includes(method)) return fail(405, 'method_not_allowed', 'Method not allowed for this connector');
    if (!pathAllowed(req.path, c.paths)) return fail(403, 'path_not_allowed', 'Path not allowed for this connector');

    let bodyObj = req.body;
    const rawBody = bodyObj === undefined ? undefined : typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
    if (rawBody !== undefined && new TextEncoder().encode(rawBody).byteLength > lim.maxRequestBytes) return fail(413, 'request_too_large', 'Request body too large');

    let secretValue;
    if (c.secret) {
        secretValue = secrets[c.secret.name];
        if (!secretValue) return fail(424, 'secret_missing', 'This connector needs a key that has not been set');
    }

    const url = new URL(`https://${c.host}${req.path}`);
    for (const [k, v] of Object.entries(req.query || {})) url.searchParams.set(k, String(v));
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers || {})) if (FORWARDED_HEADERS.has(k.toLowerCase())) headers.set(k, String(v));
    let body = rawBody;
    if (c.secret?.in === 'query') url.searchParams.set(c.secret.field, secretValue);
    else if (c.secret?.in === 'header') headers.set(c.secret.field, secretValue);
    else if (c.secret?.in === 'body') {
        let obj;
        try { obj = bodyObj === undefined ? {} : typeof bodyObj === 'string' ? JSON.parse(bodyObj) : { ...bodyObj }; } catch { return fail(400, 'bad_body', 'Body must be a JSON object'); }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail(400, 'bad_body', 'Body must be a JSON object');
        obj[c.secret.field] = secretValue;
        body = JSON.stringify(obj);
    }
    if (body !== undefined && method !== 'GET') headers.set('content-type', 'application/json');

    const guard = await checkUrl(url.toString(), { resolve });
    if (!guard.ok) return fail(403, 'blocked_host', 'Destination is not allowed');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), lim.timeoutMs);
    try {
        const res = await fetchImpl(url.toString(), { method, headers, body: method === 'GET' ? undefined : body, redirect: 'manual', signal: ctrl.signal });
        if (res.status >= 300 && res.status < 400) return fail(502, 'redirect_blocked', 'Upstream tried to redirect');
        const text = await readCapped(res, lim.maxResponseBytes, ctrl.signal);
        if (text === null) return fail(502, 'response_too_large', 'Upstream response too large');
        return { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/plain' }, body: redact(text, secretValue) };
    } catch (e) {
        if (e?.name === 'AbortError') return fail(504, 'upstream_timeout', 'Upstream did not answer in time');
        return fail(502, 'upstream_error', 'Could not reach the upstream service');
    } finally {
        clearTimeout(timer);
    }
}
