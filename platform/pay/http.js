// HTTP mapping for /<app>/pay/{checkout,orders,webhook}. Kept out of proxy-app/server.js so that file only gains a small route block.
// handle() resolves to { status, body, headers }: it never writes to the response itself.
export const PAY_OPS = ['checkout', 'orders', 'webhook'];
export const PAY_ROUTE = new RegExp(`^/([a-z0-9][a-z0-9-]{0,62})/pay/(${PAY_OPS.join('|')})$`);
export const MAX_JSON_BYTES = 8 * 1024;
export const MAX_WEBHOOK_BYTES = 64 * 1024;

async function readBody(req, max) {
    if (Number(req.headers['content-length']) > max) return { error: 413 };
    let size = 0; const chunks = [];
    for await (const c of req) {
        size += c.length;
        if (size > 4 * max) { req.destroy(); return { error: 413 }; } // a client that lies about its length gets cut off
        if (size <= max) chunks.push(c);
    }
    return size > max ? { error: 413 } : { value: Buffer.concat(chunks) };
}

function originAllowed(origin, appId, app, baseDomain) {
    let u; try { u = new URL(origin); } catch { return false; }
    return u.protocol === 'https:' && (u.hostname === `${appId}.${baseDomain}` || (app.domains || []).includes(u.hostname));
}

export function createPayHttp({ service, appStore, baseDomain }) {
    return {
        async handle({ op, appId, req, ip }) {
            const out = (status, error) => ({ status, body: { error }, headers: {} });
            const app = await appStore.get(appId);
            if (!app) return out(404, 'unknown_app');
            if (op === 'webhook') {
                // Called by Stripe's servers, never by a browser: no CORS, no Origin check. Authenticated by the signature alone.
                if (req.method !== 'POST') return out(405, 'method_not_allowed');
                const raw = await readBody(req, MAX_WEBHOOK_BYTES);
                if (raw.error) return out(raw.error, 'request_too_large');
                const r = await service.webhook({ appId, ip, rawBody: raw.value, signature: req.headers['stripe-signature'] });
                return { headers: {}, ...r };
            }
            const origin = req.headers.origin;
            const okOrigin = origin ? originAllowed(origin, appId, app, baseDomain) : true;
            const headers = origin && okOrigin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
            if (req.method === 'OPTIONS') {
                if (!origin || !okOrigin) return out(403, 'origin_not_allowed');
                return { status: 204, body: undefined, headers: { ...headers, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600' } };
            }
            if (req.method !== 'POST') return { ...out(405, 'method_not_allowed'), headers };
            if (!okOrigin) return out(403, 'origin_not_allowed');
            const raw = await readBody(req, MAX_JSON_BYTES);
            if (raw.error) return { ...out(raw.error, 'request_too_large'), headers };
            let json;
            try { json = JSON.parse(raw.value.toString('utf8') || 'null'); } catch { json = undefined; }
            if (!json || typeof json !== 'object' || Array.isArray(json)) return { ...out(400, 'bad_json'), headers };
            const bearer = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''))?.[1];
            const r = await (op === 'checkout'
                ? service.checkout({ appId, app, ip, origin, bearer, body: json })
                : service.orders({ appId, app, ip, bearer }));
            return { ...r, headers: { ...headers, ...(r.headers || {}) } };
        },
    };
}
