// Creator-keyed Stripe checkout. The creator pastes their OWN Stripe secret key (vault name STRIPE_SECRET_KEY) and, for the
// webhook, their endpoint signing secret (STRIPE_WEBHOOK_SECRET). The browser may only name a catalog item and a quantity.
// Every result is { status, body, headers? } with short error codes; Stripe's own messages are never passed on.
import { validatePay } from './catalog.js';
import { buildCheckoutForm, createCheckoutSession, keyMode, verifyStripeSignature } from './stripe.js';

export const SECRET_KEY_NAME = 'STRIPE_SECRET_KEY';
export const WEBHOOK_SECRET_NAME = 'STRIPE_WEBHOOK_SECRET';
export const DEFAULT_LIMITS = { checkoutPerAppPerHour: 60, checkoutPerAppPerDay: 500, checkoutPerIpPerHour: 10, webhookPerIpPerMin: 120 };
const PATH = /^\/[A-Za-z0-9._~\-/]*$/;
const GATE_STATUS = { app_disabled: 403, limiter_unavailable: 503, bad_request: 400 };
const STRIPE_STATUS = { stripe_key_invalid: 502, stripe_rate_limited: 503, stripe_rejected: 502, stripe_unavailable: 502, stripe_timeout: 504, stripe_bad_response: 502 };
const HANDLED = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

const err = (status, error, headers) => ({ status, body: { error }, ...(headers ? { headers } : {}) });
const safePath = (p) => typeof p === 'string' && p.length <= 200 && PATH.test(p) && !p.includes('//') && !p.split('/').some((s) => s === '..' || s === '.');

export function createPayService({ secretStore, limiter, limiterStore, orderStore, auth, fetchImpl, baseDomain, now = () => Date.now(), limits = {} }) {
    const lim = { ...DEFAULT_LIMITS, ...limits };

    async function bearerUser(appId, bearer) {
        if (!bearer || !auth) return null;
        const s = await auth.verifySession({ appId, token: bearer });
        return s.ok ? s.user : null;
    }

    function originFor(appId, app, requestOrigin) {
        if (requestOrigin) {
            try { const u = new URL(requestOrigin); if (u.protocol === 'https:' && (app.domains || []).includes(u.hostname)) return `https://${u.hostname}`; } catch { /* fall through to the default */ }
        }
        return `https://${appId}.${baseDomain}`;
    }

    return {
        async checkout({ appId, app, ip, origin, bearer, body }) {
            if (!app.enabled) return err(403, 'app_disabled');
            const gate = await limiter.check({ appId, ip });
            if (!gate.ok) return err(GATE_STATUS[gate.reason] || 429, gate.reason, gate.retryAfterSec > 0 ? { 'retry-after': String(gate.retryAfterSec) } : undefined);

            const itemId = body?.item;
            const quantity = body?.quantity === undefined ? 1 : body.quantity;
            const successPath = body?.successPath === undefined ? '/' : body.successPath;
            const cancelPath = body?.cancelPath === undefined ? '/' : body.cancelPath;
            if (typeof itemId !== 'string' || !itemId) return err(400, 'bad_request');
            if (!safePath(successPath) || !safePath(cancelPath)) return err(400, 'bad_path');
            if (!app.manifest?.pay || !validatePay(app.manifest.pay).ok) return err(404, 'payments_not_configured');
            const item = app.manifest.pay.catalog.find((c) => c.id === itemId);
            if (!item) return err(404, 'unknown_item');
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > (item.maxQuantity ?? 1)) return err(400, 'bad_quantity');

            let key;
            try { key = await secretStore.get(appId, SECRET_KEY_NAME); } catch { return err(500, 'internal'); }
            if (!key) return err(424, 'stripe_key_missing');

            // Caps on real Stripe session creation, counted only once the request is valid and a key exists.
            try {
                const hour = Math.floor(now() / 3_600_000), day = Math.floor(now() / 86_400_000);
                const untilHour = 3600 - (Math.floor(now() / 1000) % 3600), untilDay = 86_400 - (Math.floor(now() / 1000) % 86_400);
                if ((await limiterStore.incr(`payip:${appId}:${ip}:${hour}`, 7200)) > lim.checkoutPerIpPerHour) return err(429, 'pay_rate_limited_ip', { 'retry-after': String(untilHour) });
                if ((await limiterStore.incr(`payh:${appId}:${hour}`, 7200)) > lim.checkoutPerAppPerHour) return err(429, 'pay_rate_limited_hour', { 'retry-after': String(untilHour) });
                if ((await limiterStore.incr(`payd:${appId}:${day}`, 2 * 86_400)) > lim.checkoutPerAppPerDay) return err(429, 'pay_daily_cap', { 'retry-after': String(untilDay) });
            } catch { return err(503, 'limiter_unavailable'); }

            const user = await bearerUser(appId, bearer).catch(() => null);
            const base = originFor(appId, app, origin);
            const form = buildCheckoutForm({
                item, quantity, appId,
                successUrl: `${base}${successPath}?vibe_pay=success&session_id={CHECKOUT_SESSION_ID}`,
                cancelUrl: `${base}${cancelPath}?vibe_pay=cancel`,
                clientReferenceId: user?.id, customerEmail: user?.email,
            });
            const r = await createCheckoutSession({ secretKey: key, body: form, fetchImpl });
            if (!r.ok) return err(STRIPE_STATUS[r.code] || 502, r.code);
            return { status: 200, body: { url: r.url, mode: keyMode(key) } };
        },

        async webhook({ appId, ip, rawBody, signature }) {
            try {
                const minute = Math.floor(now() / 60_000);
                if ((await limiterStore.incr(`payhook:${appId}:${ip}:${minute}`, 120)) > lim.webhookPerIpPerMin) return err(429, 'rate_limited_ip', { 'retry-after': '60' });
            } catch { return err(503, 'limiter_unavailable'); }
            let secret;
            try { secret = await secretStore.get(appId, WEBHOOK_SECRET_NAME); } catch { return err(500, 'internal'); }
            if (!secret) return err(503, 'webhook_not_configured');
            const v = verifyStripeSignature({ rawBody, header: signature, secret, nowSec: Math.floor(now() / 1000) });
            if (!v.ok) return err(400, 'bad_signature');
            let event;
            try { event = JSON.parse(rawBody.toString('utf8')); } catch { return err(400, 'bad_payload'); }
            const s = event?.data?.object;
            if (!event || !HANDLED.has(event.type) || !s || s.object !== 'checkout.session') return { status: 200, body: { received: true, ignored: true } };
            // Only sessions this platform created for this app, and only once the money has actually been paid.
            const meta = s.metadata || {};
            const qty = /^\d{1,3}$/.test(String(meta.vibe_qty)) ? Number(meta.vibe_qty) : 0;
            const valid = s.payment_status === 'paid' && meta.vibe_app === appId
                && typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 255
                && typeof meta.vibe_item === 'string' && meta.vibe_item.length > 0 && meta.vibe_item.length <= 64
                && qty >= 1 && qty <= 100
                && Number.isInteger(s.amount_total) && s.amount_total >= 0
                && typeof s.currency === 'string' && /^[a-z]{3}$/.test(s.currency);
            if (!valid) return { status: 200, body: { received: true, ignored: true } };
            const ref = typeof s.client_reference_id === 'string' && s.client_reference_id.length <= 200 ? s.client_reference_id : null;
            const emailRaw = s.customer_details?.email ?? s.customer_email;
            const email = typeof emailRaw === 'string' && emailRaw.length <= 254 ? emailRaw : null;
            const r = await orderStore.record({ appId, sessionId: s.id, itemId: meta.vibe_item, quantity: qty, amountCents: s.amount_total, currency: s.currency, clientReferenceId: ref, customerEmail: email });
            return { status: 200, body: { received: true, duplicate: !r.created } };
        },

        async orders({ appId, app, ip, bearer }) {
            if (!app.enabled) return err(403, 'app_disabled');
            const user = await bearerUser(appId, bearer).catch(() => null);
            if (!user) return err(401, 'unauthorized');
            const gate = await limiter.check({ appId, ip });
            if (!gate.ok) return err(GATE_STATUS[gate.reason] || 429, gate.reason, gate.retryAfterSec > 0 ? { 'retry-after': String(gate.retryAfterSec) } : undefined);
            return { status: 200, body: { orders: await orderStore.listForUser({ appId, userId: user.id }) } };
        },
    };
}
