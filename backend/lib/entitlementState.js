// One place that says what a user_subscriptions row means. Used by the read path (getSubscriptionStatus) and by both webhooks
// (Stripe and RevenueCat), so a row written by either is read the same way.
//
// Model (unchanged): tier + status + expires_at, with EXPIRY APPLIED AT READ TIME. A row keeps tier 'pro' after it lapses and the
// reader treats it as free once expires_at has passed; the periodic tier sweep then lowers the limits of the user's deployed apps.
// Rows whose expires_at is null never lapse by time (web rows written by checkout, winback grants).

/** Statuses that keep paid access while the row is unexpired. 'past_due' is the payment-retry grace window (see PAST_DUE_GRACE_MS). */
export const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Grace policy for a failed renewal payment: a past_due subscription keeps its paid tier for this long and then drops to free
 * by itself (expires_at is set to detection time + this window, and a repeat failure does not extend it). Stripe's payment
 * retries normally finish inside this window; if the card is fixed, invoice.paid / customer.subscription.updated restores a
 * normal expiry. Mobile stores run their own grace periods, so RevenueCat rows use the store's grace expiry instead.
 */
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export const PAID_TIERS = new Set(['pro', 'team']);

export function isPaidTier(tier) { return PAID_TIERS.has(tier); }

/** True when the row currently gives a paid tier. */
export function rowGrantsAccess(row, now = Date.now()) {
    if (!row || !isPaidTier(row.tier) || !ENTITLED_STATUSES.has(row.status)) return false;
    if (!row.expires_at) return true;
    const t = new Date(row.expires_at).getTime();
    return Number.isNaN(t) ? false : t >= now;
}

/** The tier the product should enforce for this row right now ('free' when lapsed or not entitled). */
export function effectiveTier(row, now = Date.now()) {
    return rowGrantsAccess(row, now) ? row.tier : 'free';
}

/** Rows written by the mobile purchase path (RevenueCat webhook). */
export function isMobilePlatform(p) { return p === 'android' || p === 'ios'; }

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
