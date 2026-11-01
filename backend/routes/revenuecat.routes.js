// POST /api/webhooks/revenuecat: RevenueCat -> user_subscriptions (see services/revenueCat.js for the rules).
// Auth: the Authorization header must equal REVENUECAT_WEBHOOK_AUTH (configured in the RevenueCat dashboard), compared in constant
// time. If the variable is unset the endpoint refuses everything with 503 (reported once): it never accepts unauthenticated calls.
import express from 'express';
import crypto from 'node:crypto';
import { reportFailure } from '../lib/failureReporter.js';
import { supabase } from '../config/database.js';
import { applyRevenueCatEvent, reportRevenueCatSkip, RetryableError } from '../services/revenueCat.js';
import { wasProcessed, recordEvent } from '../services/billingEvents.js';
import { syncTierLimitsForUser } from '../services/tierSync.js';
import { getSubscriptionStatus } from '../services/subscriptionService.js';

const router = express.Router();
let reportedUnset = false;
/** Tests only. */
export function _resetRevenueCatRouteState() { reportedUnset = false; }

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
function authorized(header, secret) {
    if (typeof header !== 'string' || !header) return false;
    const want = digest(secret);
    // Accept the value exactly as configured, or with a "Bearer " prefix in front of it (dashboard users enter either form).
    const a = crypto.timingSafeEqual(digest(header), want);
    const b = crypto.timingSafeEqual(digest(header.replace(/^Bearer\s+/i, '')), want);
    return a || b;
}

router.post('/', express.json({ limit: '1mb' }), async (req, res) => {
    const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
    if (!secret) {
        if (!reportedUnset) { reportedUnset = true; reportFailure('billing:revenuecat_webhook_config', new Error('RevenueCat webhook refused: REVENUECAT_WEBHOOK_AUTH is not set')); }
        return res.status(503).json({ error: 'RevenueCat webhook is not configured' });
    }
    if (!authorized(req.headers.authorization, secret)) return res.status(401).json({ error: 'Unauthorized' });

    const event = req.body?.event;
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return res.status(400).json({ error: 'Invalid payload' });
    const eventId = typeof event.id === 'string' ? event.id : null;

    try {
        if (await wasProcessed(supabase, 'revenuecat', eventId)) return res.json({ received: true, duplicate: true });

        const result = await applyRevenueCatEvent(supabase, event);
        if (result.outcome === 'skipped' && result.report) reportRevenueCatSkip(event, result.reason);

        await recordEvent(supabase, {
            source: 'revenuecat', eventId, subject: result.userId ?? null, eventType: event.type,
            eventCreatedMs: Number.isFinite(event.event_timestamp_ms) ? event.event_timestamp_ms : null, outcome: result.outcome === 'applied' ? 'applied' : `skipped:${result.reason}`,
        });

        if (result.outcome === 'applied' && result.userId) {
            // The plan changes the size of the user's apps' usage caps: apply now rather than at the next sweep.
            syncTierLimitsForUser({ supabase, proxyAdmin: req.app.locals.proxyAdmin, userId: result.userId, getStatus: getSubscriptionStatus }).catch(() => {});
        }
        req.app.locals.tierSweep?.trigger?.();
        return res.json({ received: true, outcome: result.outcome, ...(result.reason ? { reason: result.reason } : {}) });
    } catch (error) {
        // 5xx makes RevenueCat retry; the report is the signal that paid events are not being applied.
        console.error('[revenuecat-webhook] Processing error:', error?.message);
        reportFailure('billing:revenuecat_webhook_processing', new Error('RevenueCat webhook processing failed'), { event_type: String(event.type).slice(0, 40), retryable: error instanceof RetryableError ? 'yes' : 'no' });
        return res.status(500).json({ error: 'Processing failed' });
    }
});

export default router;
