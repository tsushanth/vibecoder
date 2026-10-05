// HTTP mapping for end-user notifications. `handle` answers null for any path that is not a notify route, so the proxy
// can mount it with a few lines. Two routes:
//   POST /<app>/notify/me          JSON {subject, text}; Bearer session; mails the signed-in user's own address only.
//   GET|POST /<app>/notify/unsubscribe?t=<token>   GET shows a confirmation form (link prefetchers must not opt people
//        out), POST records the opt-out (also the RFC 8058 one-click POST that mail clients send).
// Errors are short codes only. No token, address or message text is ever echoed.
const ROUTE = /^\/([a-z0-9][a-z0-9-]{0,62})\/notify\/(me|unsubscribe)$/;
const MAX_BODY = 8_000;
const STATUS = {
    invalid_content: 400, unknown_user: 401, unknown_app: 404, app_disabled: 403, opted_out: 409,
    rate_limited: 429, send_failed: 502, unavailable: 503,
};

function originAllowed(origin, appId, app, baseDomain) {
    let u; try { u = new URL(origin); } catch { return false; }
    return u.protocol === 'https:' && (u.hostname === `${appId}.${baseDomain}` || (app.domains || []).includes(u.hostname));
}

async function readJsonObject(req, max) {
    let size = 0; const chunks = [];
    for await (const c of req) {
        size += c.length;
        if (size > 4 * max) { req.destroy(); return { error: 413 }; }
        if (size <= max) chunks.push(c);
    }
    if (size > max) return { error: 413 };
    try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : { error: 400 }; } catch { return { error: 400 }; }
}

async function drain(req, max = 4096) {
    let size = 0;
    for await (const c of req) { size += c.length; if (size > max) { req.destroy(); return; } }
}

const page = (appId, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email preferences</title><style>body{font:16px system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#222}button{font:inherit;padding:.6rem 1.2rem}</style></head><body>${inner}</body></html>`;
const HTML = {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
};

export function createNotifyHttp({ svc, auth, appStore, limiter, baseDomain }) {
    return {
        async handle(req, url, ip) {
            const m = ROUTE.exec(url.pathname);
            if (!m) return null;
            const [, appId, op] = m;
            const out = (status, body, headers = {}) => ({ appId, status, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
            const json = (status, obj, headers = {}) => out(status, obj, { 'content-type': 'application/json', ...headers });
            const html = (status, inner) => out(status, page(appId, inner), HTML);
            if (!svc) return json(503, { error: 'notify_unavailable' });
            const app = await appStore.get(appId);
            if (!app) return op === 'unsubscribe' ? html(404, '<p>This link is not valid.</p>') : json(404, { error: 'unknown_app' });

            if (op === 'unsubscribe') {
                if (req.method !== 'GET' && req.method !== 'POST') return html(405, '<p>Method not allowed.</p>');
                const token = url.searchParams.get('t') || '';
                if (req.method === 'GET') {
                    if (!svc.checkUnsubscribeToken({ appId, token })) return html(400, '<p>This unsubscribe link is not valid.</p>');
                    return html(200, `<p>Stop receiving emails from <b>${appId}</b>?</p><form method="post" action="/${appId}/notify/unsubscribe?t=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`);
                }
                await drain(req);
                const r = await svc.unsubscribe({ appId, token });
                if (r.ok) return html(200, `<p>You will no longer receive emails from <b>${appId}</b>.</p>`);
                return html(r.reason === 'unavailable' ? 503 : 400, r.reason === 'unavailable' ? '<p>Please try again in a moment.</p>' : '<p>This unsubscribe link is not valid.</p>');
            }

            // notify/me: called from the app's page, so the same origin rules as the other app routes apply.
            const origin = req.headers.origin;
            const okOrigin = origin ? originAllowed(origin, appId, app, baseDomain) : true;
            const cors = origin && okOrigin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
            if (req.method === 'OPTIONS') {
                if (!origin || !okOrigin) return json(403, { error: 'origin_not_allowed' });
                return out(204, '', { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600' });
            }
            if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors);
            if (!okOrigin) return json(403, { error: 'origin_not_allowed' });
            if (!app.enabled) return json(403, { error: 'app_disabled' }, cors);
            const gate = await limiter.check({ appId, ip });
            if (!gate.ok) return json(gate.reason === 'app_disabled' ? 403 : 429, { error: gate.reason }, cors);
            const body = await readJsonObject(req, MAX_BODY);
            if (body.error) return json(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' }, cors);
            const bearer = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''))?.[1];
            const session = await auth.verifySession({ appId, token: bearer });
            if (!session.ok) return json(401, { error: 'unauthorized' }, cors);
            // Only subject and text are read from the body. Whatever else the page sends (to, cc, from, headers, html) is ignored.
            const r = await svc.sendToUser({ appId, userId: session.user.id, subject: body.value.subject, text: body.value.text });
            if (r.ok) return json(200, { ok: true }, cors);
            const extra = { ...cors, ...(r.retryAfterSec ? { 'retry-after': String(r.retryAfterSec) } : {}) };
            return json(STATUS[r.reason] ?? 500, { error: r.reason, ...(r.detail ? { detail: r.detail } : {}) }, extra);
        },
    };
}
