// HTTP layer for the vibe-proxy Fly app. All platform logic lives in ../vibe-proxy; this file only does
// routing, CORS, body limits, client IP and logging. Storage, fetch and DNS are injected so it is testable.
import { guardedProxy } from '../vibe-proxy/guarded.js';
import { aiChat } from '../vibe-proxy/ai.js';
import { resolveManifest } from '../vibe-proxy/builtins.js';
import { validateManifest } from '../vibe-proxy/manifest.js';
import { createAdmin } from './admin.js';
import { handleAuth, AUTH_OPS } from '../auth/routes.js';
import { PAY_ROUTE } from '../pay/http.js';
import { handleDb } from '../data/routes.js';
import { kindForRoute } from '../vibe-proxy/usage.js';
import { handleStorage, STORAGE_OPS, MAX_UPLOAD_BYTES } from '../storage/routes.js';

const MAX_BODY = 200_000;
const ROUTE = new RegExp(`^/([a-z0-9][a-z0-9-]{0,62})/(api|ai|auth/(?:${AUTH_OPS.join('|')})|db|storage/(?:${STORAGE_OPS.join('|')}))$`);
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

export async function readRaw(req, max) {
    if (Number(req.headers['content-length']) > max) return { error: 413 };
    let size = 0; const chunks = [];
    for await (const c of req) {
        size += c.length;
        if (size > 4 * max) { req.destroy(); return { error: 413 }; } // a client that lies about its length gets cut off
        if (size <= max) chunks.push(c);
    }
    return size > max ? { error: 413 } : { value: Buffer.concat(chunks) };
}

export function createHandler({ dataExecutor, storageService, authService, appStore, secretStore, limiter, globalAiLimiter, meter, fetchImpl, resolve, openRouterKey, log = () => {}, baseDomain, adminToken, upsertApp, ensureApp, setEnabled, setDomains, setManifest, copySecrets, limiterStore, payHttp, notifyHttp, jobsAdmin, usage, usageAdmin, limitsFor }) {
    const admin = adminToken ? createAdmin({ token: adminToken, jobsAdmin, usageAdmin, appStore, upsertApp, ensureApp, setEnabled, setDomains, setManifest, copySecrets, secretStore, limiterStore, baseDomain, dataExecutor }) : null;
    const aiLimiter = {
        async check(a) {
            const r = await limiter.check(a);
            if (!r.ok) return r;
            const g = await globalAiLimiter.check({ appId: '__platform_ai__', ip: 'platform' });
            return g.ok ? g : { ok: false, reason: g.reason === 'spend_cap' ? 'platform_ai_cap' : g.reason, retryAfterSec: g.retryAfterSec };
        },
        async recordSpend(a) { await limiter.recordSpend(a); await usage?.record({ appId: a.appId, kind: 'ai', calls: 0, spendMicros: a.micros }); await globalAiLimiter.recordSpend({ appId: '__platform_ai__', micros: a.micros }); },
    };

    return async function handler(req, res) {
        const t0 = Date.now();
        let appId = '-', route = '-', headers = { ...BASE_HEADERS };
        let ukind = null, urows = 0, ubytes = 0; // what to meter for this request; set once the route and app are known
        const send = (status, body, extra = {}) => {
            res.writeHead(status, { ...headers, ...extra });
            res.end(body ?? '');
            // counts, bytes, ms and status only. A 404 (unknown app or route) is never metered, so garbage app ids cannot create rows.
            if (ukind && usage && status !== 404) usage.record({ appId, kind: ukind, status, ms: Date.now() - t0, rows: urows, bytes: ubytes }).catch(() => {});
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
                const out = await admin({ method: req.method, pathname: url.pathname, query: url.searchParams, headers: req.headers, ip, readBody: (limit) => readJson(req, limit) });
                return out.body === undefined ? send(out.status, '') : sendJson(out.status, out.body);
            }
            if (notifyHttp) { // end-user notifications (platform/notify): answers null for any other path
                const nout = await notifyHttp.handle(req, url, req.headers['fly-client-ip'] || req.socket.remoteAddress || '');
                if (nout) { appId = nout.appId; route = 'notify'; if (url.pathname.endsWith('/notify/me') && req.method === 'POST') ukind = kindForRoute('notify/me'); headers = { ...headers, ...nout.headers }; return send(nout.status, nout.body); }
            }
            const pm = payHttp ? PAY_ROUTE.exec(url.pathname) : null; // creator-keyed Stripe checkout: /<app>/pay/{checkout,orders,webhook}
            if (pm) {
                [, appId] = pm; route = `pay/${pm[2]}`; if (req.method === 'POST') ukind = kindForRoute(route);
                const out = await payHttp.handle({ op: pm[2], appId, req, ip: req.headers['fly-client-ip'] || req.socket.remoteAddress || '' });
                headers = { ...headers, ...out.headers };
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
            if (route !== 'api' && route !== 'ai') ukind = kindForRoute(route); // api and ai are metered by the meter, with their connector and spend
            const isUpload = route === 'storage/upload';
            const body = isUpload ? await readRaw(req, MAX_UPLOAD_BYTES) : await readJson(req);
            if (body.error) return sendJson(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
            const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress || '';
            let result;
            if (route === 'db') {
                const gate = await limiter.check({ appId, ip });
                if (!gate.ok) return sendJson(gate.reason === 'app_disabled' ? 403 : 429, { error: gate.reason });
                const bearer = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''))?.[1];
                const out = await handleDb({ body: body.value, bearer, appId, auth: authService, executor: dataExecutor, limitsFor });
                urows = Array.isArray(out.body?.rows) ? out.body.rows.length : 0;
                return sendJson(out.status, out.body);
            }
            if (route.startsWith('storage/')) {
                const gate = await limiter.check({ appId, ip });
                if (!gate.ok) return sendJson(gate.reason === 'app_disabled' ? 403 : 429, { error: gate.reason });
                const bearer = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''))?.[1];
                const out = await handleStorage({ op: route.slice(8), bearer, query: url.searchParams, contentType: req.headers['content-type'], body: isUpload ? body.value : undefined, json: isUpload ? undefined : body.value, appId, auth: authService, storage: storageService });
                if (isUpload && out.status === 200) ubytes = body.value.length;
                return sendJson(out.status, out.body);
            }
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
        } catch (e) {
            // Name and database/system code only: an error message can carry request values, so it is never logged.
            log(JSON.stringify({ ts: new Date().toISOString(), event: 'error', appId, route, name: typeof e?.name === 'string' ? e.name.slice(0, 40) : 'Error', code: typeof e?.code === 'string' && /^[A-Za-z0-9_]{1,20}$/.test(e.code) ? e.code : undefined }));
            return sendJson(500, { error: 'internal' });
        }
    };
}
