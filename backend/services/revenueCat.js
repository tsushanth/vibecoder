// RevenueCat -> user_subscriptions. Android buys through RevenueCat (VibeBuild project proj30e3762b); this turns its webhook
// events (and, where an event carries no entitlement data, its REST API) into the same row the Stripe path writes, with
// platform 'android' | 'ios', so getSubscriptionStatus treats a mobile payer like any other.
//
// Which VibeBuild user an event belongs to: the Supabase user id (a UUID). The clients must call Purchases.logIn(<supabase id>);
// until they do, RevenueCat uses an anonymous "$RCAnonymousID:..." id and such events cannot be mapped (they are skipped and
// reported; the later TRANSFER event that logIn() causes carries both ids and is handled by re-reading RevenueCat).
//
// Row conventions for RevenueCat-written rows: platform android|ios, product_id = the store product id, expires_at = the store's
// expiry (the read path treats the row as free after it), receipt_data = 'rc:<event_timestamp_ms>' (ordering marker: an event
// older than the marker is stale and ignored). One row per user: a web or winback row that currently grants access is never
// overwritten by a mobile event, and mobile events never downgrade a row they did not write.
import { reportFailure } from '../lib/failureReporter.js';
import { UUID_RE, isMobilePlatform, isPaidTier, rowGrantsAccess } from '../lib/entitlementState.js';

const RC_API = 'https://api.revenuecat.com/v1';
const MARKER_RE = /^rc:(\d+)$/;

/** Thrown for failures worth a retry by RevenueCat (it retries non-2xx). */
export class RetryableError extends Error {}

let injectedFetch = null;
/** Tests only. */
export function _setRevenueCatFetch(fn) { injectedFetch = fn; }

export function revenueCatRestConfigured() { return !!process.env.REVENUECAT_SECRET_API_KEY; }

// ---- mapping ---------------------------------------------------------------------------------------------------------------

export function platformOfStore(store) {
    const s = String(store || '').toUpperCase();
    if (s === 'PLAY_STORE') return 'android';
    if (s === 'APP_STORE' || s === 'MAC_APP_STORE') return 'ios';
    return null;
}

/** The Supabase user id for an event: app_user_id when it is a UUID, else the single UUID among the other ids. null if none. */
export function resolveUserId(event) {
    const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
    if (isUuid(event?.app_user_id)) return event.app_user_id;
    const others = [...new Set([event?.original_app_user_id, ...(Array.isArray(event?.aliases) ? event.aliases : [])].filter(isUuid))];
    return others.length === 1 ? others[0] : null;
}

export function tierFor(entitlementIds, productId) {
    const ids = Array.isArray(entitlementIds) ? entitlementIds.map((x) => String(x).toLowerCase()) : [];
    if (ids.includes('team') || /team/i.test(String(productId || ''))) return 'team';
    return 'pro';
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---- REST ------------------------------------------------------------------------------------------------------------------

/** Reads the subscriber from RevenueCat and returns what they currently hold, or { active: false }. Needs REVENUECAT_SECRET_API_KEY. */
export async function fetchEntitlementFromRevenueCat(appUserId, nowMs = Date.now()) {
    const key = process.env.REVENUECAT_SECRET_API_KEY;
    if (!key) throw new RetryableError('REVENUECAT_SECRET_API_KEY is not set');
    const doFetch = injectedFetch || fetch;
    let res;
    try {
        res = await doFetch(`${RC_API}/subscribers/${encodeURIComponent(appUserId)}`, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000) });
    } catch { throw new RetryableError('RevenueCat REST request failed'); }
    if (!res.ok) throw new RetryableError(`RevenueCat REST status ${res.status}`);
    const body = await res.json().catch(() => null);
    return deriveFromSubscriber(body?.subscriber, nowMs);
}

export function deriveFromSubscriber(sub, nowMs) {
    const ents = sub?.entitlements && typeof sub.entitlements === 'object' ? sub.entitlements : {};
    const subs = sub?.subscriptions && typeof sub.subscriptions === 'object' ? sub.subscriptions : {};
    let best = null;
    for (const [id, e] of Object.entries(ents)) {
        const exp = e?.expires_date ? Date.parse(e.expires_date) : null; // null = does not expire
        const grace = e?.grace_period_expires_date ? Date.parse(e.grace_period_expires_date) : null;
        const until = exp === null ? Infinity : Math.max(exp, Number.isFinite(grace) ? grace : 0);
        if (!(until > nowMs)) continue;
        const tier = tierFor([id], e?.product_identifier);
        const rank = tier === 'team' ? 2 : 1;
        if (!best || rank > best.rank || (rank === best.rank && until > best.until)) best = { rank, tier, until, product: e?.product_identifier || null };
    }
    if (!best) return { active: false };
    const platform = platformOfStore(subs[best.product]?.store);
    return { active: true, tier: best.tier, platform, productId: best.product, expiresAtMs: best.until === Infinity ? null : best.until };
}

// ---- applying --------------------------------------------------------------------------------------------------------------

async function readRow(supabase, userId) {
    const { data, error } = await supabase.from('user_subscriptions').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw new RetryableError('user_subscriptions read failed');
    return data || null;
}

async function writeRow(supabase, userId, existing, changes) {
    const row = {
        user_id: userId,
        tier: existing?.tier ?? 'free',
        status: existing?.status ?? 'active',
        platform: existing?.platform ?? null,
        product_id: existing?.product_id ?? null,
        receipt_data: existing?.receipt_data ?? null,
        expires_at: existing?.expires_at ?? null,
        ...changes,
        updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('user_subscriptions').upsert(row, { onConflict: 'user_id' });
    if (error) throw new RetryableError('user_subscriptions upsert failed');
}

const markerMs = (row) => { const m = MARKER_RE.exec(row?.receipt_data || ''); return m ? Number(m[1]) : null; };
const skipped = (reason, report = false) => ({ outcome: 'skipped', reason, report });

/** A store-derived entitlement (event payload or REST) becomes the user's row. */
async function applyGrant(supabase, userId, existing, { tier, platform, productId, expiresAtMs, tsMs, nowMs }) {
    if (existing && rowGrantsAccess(existing, nowMs) && !isMobilePlatform(existing.platform)) {
        return skipped('other_active_source', true); // a web/winback entitlement is in force: one row per user, do not replace it
    }
    const lapsed = expiresAtMs !== null && expiresAtMs <= nowMs;
    await writeRow(supabase, userId, existing, {
        tier: lapsed ? 'free' : tier,
        status: lapsed ? 'expired' : 'active',
        platform, product_id: productId ?? null,
        expires_at: iso(expiresAtMs),
        receipt_data: `rc:${tsMs}`,
    });
    return { outcome: 'applied' };
}

/** Marks a row RevenueCat wrote as lapsed. Does nothing to rows it did not write. */
async function applyLapse(supabase, userId, existing, { platform, productId, expiresAtMs, tsMs, nowMs, status = 'expired' }) {
    if (!existing || !isMobilePlatform(existing.platform)) return skipped('no_mobile_row');
    if (existing.platform !== platform) return skipped('other_store_row');
    if (productId && existing.product_id && existing.product_id !== productId) return skipped('other_product_row');
    await writeRow(supabase, userId, existing, { tier: 'free', status, expires_at: iso(expiresAtMs ?? nowMs), receipt_data: `rc:${tsMs}` });
    return { outcome: 'applied' };
}

/** Re-reads RevenueCat for a user and makes their row match. Used by TRANSFER and by verifyReceipt. */
export async function syncUserFromRevenueCat(supabase, userId, { tsMs = Date.now(), nowMs = Date.now() } = {}) {
    const ent = await fetchEntitlementFromRevenueCat(userId, nowMs);
    const existing = await readRow(supabase, userId);
    if (!ent.active) {
        const r = await applyLapse(supabase, userId, existing, { platform: existing?.platform, productId: null, expiresAtMs: nowMs, tsMs, nowMs });
        return { ...r, entitlement: ent };
    }
    if (!ent.platform) return { ...skipped('unsupported_store', true), entitlement: ent };
    const r = await applyGrant(supabase, userId, existing, { tier: ent.tier, platform: ent.platform, productId: ent.productId, expiresAtMs: ent.expiresAtMs, tsMs, nowMs });
    return { ...r, entitlement: ent };
}

const GRANT_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION']);
export const HANDLED_TYPES = new Set([...GRANT_TYPES, 'CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED', 'TRANSFER', 'TEST']);

/**
 * Applies one RevenueCat event. Returns { outcome: 'applied'|'skipped', reason?, report?, userId? }; throws RetryableError for
 * failures RevenueCat should retry (database or REST trouble). Pure of Express: the route does auth, dedupe and reporting.
 */
export async function applyRevenueCatEvent(supabase, event, nowMs = Date.now()) {
    const type = String(event?.type || '');
    if (type === 'TEST') return { outcome: 'applied', reason: 'test' };
    if (!HANDLED_TYPES.has(type)) return skipped('unhandled_type', true);
    const tsMs = num(event.event_timestamp_ms) ?? nowMs;

    if (type === 'TRANSFER') {
        const ids = [...new Set([...(event.transferred_to || []), ...(event.transferred_from || [])].filter((v) => typeof v === 'string' && UUID_RE.test(v)))];
        if (!ids.length) return skipped('transfer_without_user');
        if (!revenueCatRestConfigured()) return skipped('rest_not_configured', true);
        for (const id of ids) await syncUserFromRevenueCat(supabase, id, { tsMs, nowMs });
        return { outcome: 'applied', reason: 'transfer', userId: ids[0] };
    }

    const platform = platformOfStore(event.store);
    if (!platform) return skipped('unsupported_store', true);
    const userId = resolveUserId(event);
    if (!userId) return skipped('unmapped_user', true);

    const existing = await readRow(supabase, userId);
    const marker = isMobilePlatform(existing?.platform) ? markerMs(existing) : null;
    if (marker !== null && tsMs < marker) return { ...skipped('stale'), userId };

    const productId = type === 'PRODUCT_CHANGE' ? (event.new_product_id || event.product_id) : event.product_id;
    const expiresAtMs = num(event.expiration_at_ms);
    let result;

    if (GRANT_TYPES.has(type)) {
        // A paid-store event without an expiry would make a lifetime grant out of a bug: refuse it rather than guess.
        if (expiresAtMs === null) return { ...skipped('missing_expiry', true), userId };
        result = await applyGrant(supabase, userId, existing, { tier: tierFor(event.entitlement_ids, productId), platform, productId, expiresAtMs, tsMs, nowMs });
    } else if (type === 'EXPIRATION') {
        result = await applyLapse(supabase, userId, existing, { platform, productId: event.product_id, expiresAtMs, tsMs, nowMs });
    } else if (type === 'CANCELLATION') {
        // Cancel = auto-renew switched off: the user keeps access until the store expiry. A refund ends it now.
        const endsNow = event.cancel_reason === 'CUSTOMER_SUPPORT' || (expiresAtMs !== null && expiresAtMs <= nowMs);
        if (endsNow) result = await applyLapse(supabase, userId, existing, { platform, productId: event.product_id, expiresAtMs, tsMs, nowMs, status: 'cancelled' });
        else if (existing && isMobilePlatform(existing.platform) && existing.platform === platform && expiresAtMs !== null) {
            await writeRow(supabase, userId, existing, { expires_at: iso(expiresAtMs), receipt_data: `rc:${tsMs}` });
            result = { outcome: 'applied' };
        } else result = skipped('no_mobile_row');
    } else if (type === 'BILLING_ISSUE') {
        // The store decides: access continues only through the store's own grace period (when it reports one).
        const graceMs = num(event.grace_period_expires_at_ms);
        if (existing && isMobilePlatform(existing.platform) && existing.platform === platform && isPaidTier(existing.tier)) {
            await writeRow(supabase, userId, existing, { status: 'past_due', expires_at: iso(graceMs ?? expiresAtMs) ?? existing.expires_at, receipt_data: `rc:${tsMs}` });
            result = { outcome: 'applied' };
        } else result = skipped('no_mobile_row');
    } else { // SUBSCRIPTION_PAUSED: access runs to the end of the paid period, then the store reports the expiry.
        if (existing && isMobilePlatform(existing.platform) && existing.platform === platform && expiresAtMs !== null) {
            await writeRow(supabase, userId, existing, { expires_at: iso(expiresAtMs), receipt_data: `rc:${tsMs}` });
            result = { outcome: 'applied' };
        } else result = skipped('no_mobile_row');
    }
    return { ...result, userId };
}

export function reportRevenueCatSkip(event, reason) {
    reportFailure('billing:revenuecat_webhook_skipped', new Error(`RevenueCat event skipped: ${reason}`), { event_type: String(event?.type ?? '').slice(0, 40), reason });
}
