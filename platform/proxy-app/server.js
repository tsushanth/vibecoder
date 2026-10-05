// HTTP layer for the vibe-proxy Fly app. All platform logic lives in ../vibe-proxy; this file only does
// routing, CORS, body limits, client IP and logging. Storage, fetch and DNS are injected so it is testable.
import { guardedProxy } from '../vibe-proxy/guarded.js';
import { aiChat } from '../vibe-proxy/ai.js';
import { resolveManifest } from '../vibe-proxy/builtins.js';
import { validateManifest } from '../vibe-proxy/manifest.js';
import { createAdmin } from './admin.js';
import { handleAuth, AUTH_OPS } from '../auth/routes.js';

const MAX_BODY = 200_000;
const ROUTE = new RegExp(`^/([a-z0-9][a-z0-9-]{0,62})/(api|ai|auth/(?:${AUTH_OPS.join('|')}))$`);
const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function originAllowed(origin, appId, app, baseDomain) {
    let u; try { u = new URL(origin); } catch { return false; }
    return u.protocol === 'https:' && (u.hostname === `${appId}.${baseDomain}` || (app.domains || []).includes(u.hostname));
}

async function readJson(req, max = MAX_BODY) {
    let size = 0; const chunks = [];
    for await (const c of req) {
        size += c.length;
        if (size > 5_000_000) { req.destroy(); break; }
        if (size <= max) chunks.push(c);
    }
    if (size > max) return { error: 413 };
    try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : { error: 400 }; } catch { return { error: 400 }; }
}

export function createHandler({ authService, appStore, secretStore, limiter, globalAiLimiter, meter, fetchImpl, resolve, openRouterKey, log = () => {}, baseDomain, adminToken, upsertApp, ensureApp, setEnabled, setDomains, setManifest, copySecrets, limiterStore }) {
    const admin = adminToken ? createAdmin({ token: adminToken, appStore, upsertApp, ensureApp, setEnabled, setDomains, setManifest, copySecrets, secretStore, limiterStore, baseDomain }) : null;
    const aiLimiter = {
        async check(a) {
            const r = await limiter.check(a);
            if (!r.ok) return r;
            const g = await globalAiLimiter.check({ appId: '__platform_ai__', ip: 'platform' });
            return g.ok ? g : { ok: false, reason: g.reason === 'spend_cap' ? 'platform_ai_cap' : g.reason, retryAfterSec: g.retryAfterSec };
        },
        async recordSpend(a) { await limiter.recordSpend(a); await globalAiLimiter.recordSpend({ appId: '__platform_ai__', micros: a.micros }); },
    };

    return async function handler(req, res) {
        const t0 = Date.now();
        let appId = '-', route = '-', headers = { ...BASE_HEADERS };
        const send = (status, body, extra = {}) => {
            res.writeHead(status, { ...headers, ...extra });
            res.end(body ?? '');
            log(JSON.stringify({ ts: new Date().toISOString(), event: 'request', appId, route, status, ms: Date.now() - t0 }));
        };
        const sendJson = (status, obj) => send(status, JSON.stringify(obj), { 'content-type': 'application/json' });
        try {
            const url = new URL(req.url, 'http://x');
            if (url.pathname === '/health' && req.method === 'GET') return sendJson(200, { ok: true });
            if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
                route = 'admin';
                appId = /^\/admin\/apps\/([^/]+)/.exec(url.pathname)?.[1]?.slice(0, 63) || '-';
                if (!admin) return sendJson(404, { error: 'not_found' });
                const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress || '';
                const out = await admin({ method: req.method, pathname: url.pathname, headers: req.headers, ip, readBody: (limit) => readJson(req, limit) });
                return out.body === undefined ? send(out.status, '') : sendJson(out.status, out.body);
            }
            const m = ROUTE.exec(url.pathname);
            if (!m) return sendJson(404, { error: 'not_found' });
            [, appId, route] = m;
            const app = await appStore.get(appId);
            if (!app) return sendJson(404, { error: 'unknown_app' });
            const origin = req.headers.origin;
            const okOrigin = origin ? originAllowed(origin, appId, app, baseDomain) : true;
            if (origin && okOrigin) headers = { ...headers, 'access-control-allow-origin': origin, vary: 'Origin' };
            if (req.method === 'OPTIONS') {
                if (!origin || !okOrigin) return sendJson(403, { error: 'origin_not_allowed' });
                return send(204, '', { 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600' });
            }
            if (req.method !== 'POST') return sendJson(405, { error: 'method_not_allowed' });
            if (!okOrigin) return sendJson(403, { error: 'origin_not_allowed' });
            if (!app.enabled) return sendJson(403, { error: 'app_disabled' });
            const body = await readJson(req);
            if (body.error) return sendJson(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
            const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress || '';
            let result;
            if (route.startsWith('auth/')) {
                const gate = await limiter.check({ appId, ip });
                if (!gate.ok) return sendJson(gate.reason === 'app_disabled' ? 403 : 429, { error: gate.reason });
                const bearer = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''))?.[1];
                const out = await handleAuth({ op: route.slice(5), body: body.value, bearer, ip, appId, svc: authService });
                return sendJson(out.status, out.body);
            }
            if (route === 'ai') {
                result = await aiChat({ req: body.value, appId, ip, apiKey: openRouterKey, fetchImpl, limiter: aiLimiter, meter });
            } else {
                const own = app.manifest?.connectors && Object.keys(app.manifest.connectors).length ? app.manifest : null;
                if (own && !validateManifest(own).ok) return sendJson(500, { error: 'bad_app_manifest' });
                const manifest = resolveManifest(own);
                const secret = manifest.connectors[body.value.connector]?.secret;
                const secrets = secret ? { [secret.name]: await secretStore.get(appId, secret.name) } : {};
                result = await guardedProxy({ limiter, meter, appId, ip, req: body.value, manifest, secrets, fetchImpl, resolve });
            }
            return send(result.status, result.body, result.headers);
        } catch {
            return sendJson(500, { error: 'internal' });
        }
    };
}
