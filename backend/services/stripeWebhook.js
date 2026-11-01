// Stripe event -> user_subscriptions. The route (routes/subscriptions.routes.js) verifies the signature and answers; this applies
// the event. Contract with the route:
//   - returns { outcome } for everything that is final (applied, skipped, stale, ignored, duplicate): the route answers 2xx so Stripe
//     stops retrying;
//   - THROWS when the event could not be applied (database or Stripe API trouble): the route answers 5xx so Stripe retries.
// Every skip that is not routine is reported with a stable message and no user data.
//
// Access policy (see lib/entitlementState.js for the read side):
//   active, trialing   -> paid tier, expires_at = end of the paid period
//   past_due           -> paid tier KEPT for PAST_DUE_GRACE_MS (7 days) from the first failure, then free; repeat failures do not extend it
//   canceled, unpaid, incomplete_expired, paused, incomplete -> free
//   full refund / dispute opened -> free immediately (a dispute that is won restores access from the live subscription)
// Tier is recomputed from the subscription on EVERY subscription event, so recovery (past_due -> active) restores the paid tier.
import { reportFailure } from '../lib/failureReporter.js';
import { PAST_DUE_GRACE_MS, isPaidTier, rowGrantsAccess } from '../lib/entitlementState.js';
import { wasProcessed, latestEventMs, recordEvent } from './billingEvents.js';

export const STRIPE_SOURCE = 'stripe';
const ENTITLING = new Set(['active', 'trialing']);
const REVOKING = new Set(['canceled', 'unpaid', 'incomplete_expired']);

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const secToMs = (s) => (typeof s === 'number' && Number.isFinite(s) ? s * 1000 : null);
// order: true = this skip still counts as "seen" for out-of-order detection (an older event for the subject must not undo it).
const skipped = (reason, { report = true, subject = null, order = false } = {}) => ({ outcome: 'skipped', reason, report, subject, order });

/** Newer Stripe API versions moved current_period_end from the subscription onto its items. Accept both. */
export function periodEndMs(sub) {
    return secToMs(sub?.current_period_end) ?? secToMs(sub?.items?.data?.[0]?.current_period_end);
}

/** Older API versions: invoice.subscription. Newer: invoice.parent.subscription_details.subscription. */
export function invoiceSubscriptionId(inv) {
    const v = inv?.subscription ?? inv?.parent?.subscription_details?.subscription;
    return typeof v === 'string' ? v : (v?.id ?? null);
}

function resolveTier(sub, existing) {
    const priceId = sub?.items?.data?.[0]?.price?.id;
    if (priceId && process.env.STRIPE_TEAM_PRICE_ID && priceId === process.env.STRIPE_TEAM_PRICE_ID) return 'team';
    if (priceId && process.env.STRIPE_PRO_PRICE_ID && priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro';
    const meta = sub?.metadata?.tier;
    if (isPaidTier(meta)) return meta;
    if (isPaidTier(existing?.tier)) return existing.tier;
    return 'pro';
}

/** The row fields a subscription's current state implies. */
export function planFromSubscription(sub, status, existing, { eventMs, nowMs }) {
    const end = periodEndMs(sub);
    if (ENTITLING.has(status)) return { tier: resolveTier(sub, existing), status: 'active', expires_at: iso(end) ?? existing?.expires_at ?? null };
    if (status === 'past_due') return { tier: resolveTier(sub, existing), status: 'past_due', expires_at: graceExpiry(existing, eventMs) };
    if (REVOKING.has(status)) return { tier: 'free', status: 'cancelled', expires_at: iso(end ?? nowMs) };
    // paused, incomplete, or a status this code has not seen: fail closed.
    return { tier: 'free', status: String(status || 'cancelled').slice(0, 30), expires_at: iso(nowMs) };
}

/** Grace deadline for a payment failure: the first failure starts it, repeats keep it, and it never shortens an expiry already further out. */
function graceExpiry(existing, eventMs) {
    if (existing?.status === 'past_due' && existing.expires_at) return existing.expires_at;
    const later = Math.max(eventMs + PAST_DUE_GRACE_MS, existing?.expires_at ? new Date(existing.expires_at).getTime() || 0 : 0);
    return iso(later);
}

/**
 * api: { customerUserId(customerId) -> userId|null, subscriptionIdForCharge(charge|{id}) -> subId|null, getSubscription(subId) -> sub|null }
 * (see stripeApiFrom). May be null when Stripe is not configured; handlers that need it then skip with a report.
 */
export function createStripeEventProcessor({ supabase, api = null, now = () => Date.now() }) {
    async function bySubscription(subId) {
        const { data, error } = await supabase.from('user_subscriptions').select('*').eq('product_id', subId).maybeSingle();
        if (error) throw new Error('user_subscriptions read failed');
        return data || null;
    }
    async function byUser(userId) {
        const { data, error } = await supabase.from('user_subscriptions').select('*').eq('user_id', userId).maybeSingle();
        if (error) throw new Error('user_subscriptions read failed');
        return data || null;
    }
    async function write(userId, existing, changes) {
        const row = {
            user_id: userId,
            tier: existing?.tier ?? 'free', status: existing?.status ?? 'active', platform: existing?.platform ?? 'web',
            product_id: existing?.product_id ?? null, receipt_data: existing?.receipt_data ?? null, expires_at: existing?.expires_at ?? null,
            ...changes, updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('user_subscriptions').upsert(row, { onConflict: 'user_id' });
        if (error) throw new Error('user_subscriptions upsert failed');
    }

    async function onCheckoutCompleted(event) {
        const session = event.data.object;
        const subId = typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);
        const userId = session.client_reference_id || session.metadata?.userId;
        if (!userId) return skipped('checkout_without_user', { subject: subId });
        if (session.mode && session.mode !== 'subscription') return skipped('checkout_not_subscription', { report: false, subject: subId });
        const tier = isPaidTier(session.metadata?.tier) ? session.metadata.tier : 'pro';
        // A completed web checkout is the user's newest explicit purchase: it replaces whatever row they had (one row per user).
        await write(userId, null, { tier, status: 'active', platform: 'web', product_id: subId, receipt_data: session.id, expires_at: null });
        return { outcome: 'applied', subject: subId };
    }

    async function onSubscription(event) {
        const sub = event.data.object;
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
        const eventMs = secToMs(event.created) ?? now();
        let row = await bySubscription(sub.id);
        let userId = row?.user_id;
        if (!row) {
            // No row for this subscription id: events can arrive before the checkout event, or the checkout event failed. Rebuild from metadata.
            if (REVOKING.has(status)) return skipped('revoke_without_row', { report: false, subject: sub.id, order: true }); // nothing to revoke
            userId = sub.metadata?.userId || (api && sub.customer ? await api.customerUserId(typeof sub.customer === 'string' ? sub.customer : sub.customer.id) : null);
            if (!userId) return skipped('subscription_without_user', { report: event.type !== 'customer.subscription.created', subject: sub.id }); // 'created' normally precedes the checkout event
            const other = await byUser(userId);
            if (other && other.product_id !== sub.id && rowGrantsAccess(other, now())) return skipped('other_active_source', { subject: sub.id });
            row = other && other.product_id === sub.id ? other : null;
        }
        if (status === 'incomplete' && !row) return skipped('incomplete_without_row', { report: false, subject: sub.id });
        const plan = planFromSubscription(sub, status, row, { eventMs, nowMs: now() });
        await write(userId, row ?? null, { ...plan, platform: 'web', product_id: sub.id });
        return { outcome: 'applied', subject: sub.id };
    }

    async function onInvoice(event) {
        const inv = event.data.object;
        const subId = invoiceSubscriptionId(inv);
        if (!subId) return skipped('invoice_without_subscription', { report: false });
        const row = await bySubscription(subId);
        const paid = event.type === 'invoice.paid';
        if (!row) return skipped('invoice_without_row', { report: !paid, subject: subId }); // a first invoice.paid normally precedes the checkout event
        if (!['active', 'past_due'].includes(row.status)) return skipped('invoice_on_inactive_row', { subject: subId }); // subscription events are authoritative for those
        const eventMs = secToMs(event.created) ?? now();
        if (paid) {
            const lineEnd = secToMs(inv.lines?.data?.[0]?.period?.end);
            const cur = row.expires_at ? new Date(row.expires_at).getTime() : null;
            const expires = row.status === 'past_due' ? (lineEnd ?? cur) : (lineEnd !== null && (cur === null || lineEnd > cur) ? lineEnd : cur);
            await write(row.user_id, row, { status: 'active', expires_at: iso(expires) });
        } else {
            await write(row.user_id, row, { status: 'past_due', expires_at: graceExpiry(row, eventMs) });
        }
        return { outcome: 'applied', subject: subId };
    }

    /** Immediately removes paid access (refund, dispute). Status is stored as given so it stays visible. */
    async function revoke(subId, status) {
        const row = await bySubscription(subId);
        if (!row) return skipped('charge_without_row', { subject: subId });
        await write(row.user_id, row, { tier: 'free', status, expires_at: iso(now()) });
        return { outcome: 'applied', subject: subId };
    }

    async function onRefund(event) {
        const charge = event.data.object;
        const full = charge.refunded === true || (typeof charge.amount === 'number' && charge.amount_refunded >= charge.amount);
        if (!full) return skipped('partial_refund'); // a partial refund is a money decision, not an access decision
        if (!api) return skipped('stripe_api_unavailable');
        const subId = await api.subscriptionIdForCharge(charge);
        if (!subId) return skipped('charge_without_subscription');
        return revoke(subId, 'refunded');
    }

    async function onDispute(event) {
        const dispute = event.data.object;
        if (!api) return skipped('stripe_api_unavailable');
        const subId = await api.subscriptionIdForCharge({ id: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id });
        if (!subId) return skipped('charge_without_subscription');
        if (event.type === 'charge.dispute.created') return revoke(subId, 'disputed');
        // closed
        if (dispute.status !== 'won' && dispute.status !== 'warning_closed') return revoke(subId, 'disputed'); // lost or anything else: stays revoked
        const sub = await api.getSubscription(subId);
        const row = await bySubscription(subId);
        if (!sub || !row) return skipped('dispute_won_without_subscription', { subject: subId });
        const status = sub.status;
        if (!ENTITLING.has(status) && status !== 'past_due') return { outcome: 'applied', subject: subId }; // won, but the subscription itself is over
        await write(row.user_id, row, planFromSubscription(sub, status, row, { eventMs: now(), nowMs: now() }));
        return { outcome: 'applied', subject: subId };
    }

    /** Subscription id an event is about, for ordering. null when it cannot be known without an API call. */
    function subjectOf(event) {
        const o = event.data?.object;
        switch (event.type) {
            case 'checkout.session.completed': return typeof o.subscription === 'string' ? o.subscription : (o.subscription?.id ?? null);
            case 'customer.subscription.created': case 'customer.subscription.updated': case 'customer.subscription.deleted': return o.id;
            case 'invoice.paid': case 'invoice.payment_failed': return invoiceSubscriptionId(o);
            default: return null;
        }
    }

    const HANDLERS = {
        'checkout.session.completed': onCheckoutCompleted,
        'customer.subscription.created': onSubscription,
        'customer.subscription.updated': onSubscription,
        'customer.subscription.deleted': onSubscription,
        'invoice.paid': onInvoice,
        'invoice.payment_failed': onInvoice,
        'charge.refunded': onRefund,
        'charge.dispute.created': onDispute,
        'charge.dispute.closed': onDispute,
    };

    return {
        /** Applies one verified event. Throws when it must be retried. */
        async process(event) {
            const type = String(event?.type ?? '');
            if (await wasProcessed(supabase, STRIPE_SOURCE, event.id)) return { outcome: 'duplicate' };
            const handler = HANDLERS[type];
            let result;
            if (!handler) {
                result = { outcome: 'ignored', reason: 'unhandled_type', report: true };
            } else {
                const eventMs = secToMs(event.created);
                const pre = subjectOf(event);
                const latest = pre && eventMs !== null ? await latestEventMs(supabase, STRIPE_SOURCE, pre) : null;
                result = latest !== null && eventMs < latest ? { outcome: 'stale', reason: 'stale', report: false, subject: pre } : await handler(event);
            }
            if (result.report) reportFailure('billing:stripe_webhook_skipped', new Error(`Stripe event skipped: ${result.reason}`), { event_type: type.slice(0, 60), reason: result.reason });
            // Only events that took effect (or order-relevant skips) advance the ordering clock.
            await recordEvent(supabase, { source: STRIPE_SOURCE, eventId: event.id, subject: result.subject ?? subjectOf(event), eventType: type, eventCreatedMs: (result.outcome === 'applied' || result.order) ? secToMs(event.created) : null, outcome: result.reason ? `${result.outcome}:${result.reason}` : result.outcome });
            return result;
        },
    };
}

/** Stripe API helpers for the handlers that need data the event does not carry. */
export function stripeApiFrom(stripe) {
    return {
        async customerUserId(customerId) {
            const c = await stripe.customers.retrieve(customerId);
            return c && !c.deleted ? (c.metadata?.userId || null) : null;
        },
        async getSubscription(subId) { return stripe.subscriptions.retrieve(subId); },
        async subscriptionIdForCharge(charge) {
            let c = charge;
            if (!c.invoice && !c.customer) c = await stripe.charges.retrieve(charge.id);
            const invRef = c.invoice;
            if (invRef) {
                const inv = typeof invRef === 'string' ? await stripe.invoices.retrieve(invRef) : invRef;
                const id = invoiceSubscriptionId(inv);
                if (id) return id;
            }
            const customer = typeof c.customer === 'string' ? c.customer : c.customer?.id;
            if (!customer) return null;
            const list = await stripe.subscriptions.list({ customer, status: 'all', limit: 5 });
            return list.data.length === 1 ? list.data[0].id : null; // ambiguous with several subscriptions: skip rather than guess
        },
    };
}
