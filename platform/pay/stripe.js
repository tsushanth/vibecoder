// Stripe pieces for creator-keyed checkout: webhook signature verification, Checkout Session request building and the REST call.
// Nothing here logs or returns Stripe's own error text: it can contain key fragments or card data.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOLERANCE_SEC = 300;
const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';
const MAX_HEADER = 1024;
const MAX_RESPONSE = 256 * 1024;

export const keyMode = (key) => (/^(sk|rk)_test_/.test(String(key)) ? 'test' : 'live');

/** Verifies a Stripe-Signature header (t=...,v1=...[,v1=...]) over `${t}.${rawBody}` with the creator's webhook signing secret. */
export function verifyStripeSignature({ rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000), toleranceSec = TOLERANCE_SEC }) {
    if (!secret) return { ok: false, reason: 'no_secret' };
    if (typeof header !== 'string' || !header) return { ok: false, reason: 'missing_header' };
    if (header.length > MAX_HEADER) return { ok: false, reason: 'malformed' };
    let t = null; const sigs = [];
    for (const part of header.split(',')) {
        const i = part.indexOf('=');
        if (i < 1) continue;
        const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
        if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
        else if (k === 'v1') sigs.push(v);
    }
    if (t === null || !sigs.length) return { ok: false, reason: 'malformed' };
    if (Math.abs(nowSec - t) > toleranceSec) return { ok: false, reason: 'stale' };
    const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
    let match = false;
    for (const s of sigs) {
        const given = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : null;
        if (given && timingSafeEqual(given, expected)) match = true; // keep scanning: constant work per signature
    }
    return match ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** Form body for POST /v1/checkout/sessions. Amount, currency and name come from the catalog item only. */
export function buildCheckoutForm({ item, quantity, successUrl, cancelUrl, appId, clientReferenceId, customerEmail }) {
    const p = new URLSearchParams();
    p.set('mode', item.mode);
    p.set('success_url', successUrl);
    p.set('cancel_url', cancelUrl);
    p.set('line_items[0][quantity]', String(quantity));
    p.set('line_items[0][price_data][currency]', item.currency);
    p.set('line_items[0][price_data][unit_amount]', String(item.amountCents));
    p.set('line_items[0][price_data][product_data][name]', item.name);
    if (item.mode === 'subscription') p.set('line_items[0][price_data][recurring][interval]', item.interval);
    if (clientReferenceId) p.set('client_reference_id', clientReferenceId);
    if (customerEmail) p.set('customer_email', customerEmail);
    p.set('metadata[vibe_app]', appId);
    p.set('metadata[vibe_item]', item.id);
    p.set('metadata[vibe_qty]', String(quantity));
    return p.toString();
}

const isStripeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'checkout.stripe.com' && !x.username && !x.password; } catch { return false; } };

export async function createCheckoutSession({ secretKey, body, fetchImpl, timeoutMs = 10_000 }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetchImpl(STRIPE_API, {
            method: 'POST',
            headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
            body, redirect: 'manual', signal: ctrl.signal,
        });
        const s = res.status;
        if (s === 401 || s === 403) return { ok: false, code: 'stripe_key_invalid' };
        if (s === 429) return { ok: false, code: 'stripe_rate_limited' };
        if (s >= 500) return { ok: false, code: 'stripe_unavailable' };
        if (s >= 400) return { ok: false, code: 'stripe_rejected' };
        if (s < 200 || s >= 300) return { ok: false, code: 'stripe_bad_response' };
        const text = await res.text();
        let j; try { j = text.length <= MAX_RESPONSE ? JSON.parse(text) : null; } catch { j = null; }
        if (!j || typeof j.id !== 'string' || !isStripeUrl(j.url)) return { ok: false, code: 'stripe_bad_response' };
        return { ok: true, url: j.url, id: j.id };
    } catch (e) {
        return { ok: false, code: e?.name === 'AbortError' ? 'stripe_timeout' : 'stripe_unavailable' };
    } finally { clearTimeout(timer); }
}
