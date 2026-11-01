import express from 'express';
import Stripe from 'stripe';
import { reportFailure } from '../lib/failureReporter.js';
import { supabase } from '../config/database.js';
import { syncTierLimitsForUser } from '../services/tierSync.js';
import { createStripeEventProcessor, stripeApiFrom } from '../services/stripeWebhook.js';
import {
    getSubscriptionStatus,
    allFreeLimits,
    verifyReceipt,
    recordUsage,
    checkUsageLimit,
    SUBSCRIPTION_TIERS,
    ACTION_TYPES
} from '../services/subscriptionService.js';
import { fairUseBody, fairUseSnapshot } from '../services/fairUse.js';
import { allFreeEnabled } from '../lib/allFree.js';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const STRIPE_PRICE_IDS = {
    pro: process.env.STRIPE_PRO_PRICE_ID,
    team: process.env.STRIPE_TEAM_PRICE_ID,
};

const WEB_APP_URL = process.env.WEB_APP_URL || 'https://vibebuild.cc';

const router = express.Router();

/**
 * GET /api/subscriptions/status
 * Get user's subscription status
 */
router.get('/status', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                error: 'userId is required'
            });
        }

        const result = await getSubscriptionStatus(userId);

        if (!result.success) {
            return res.status(500).json({
                error: result.error
            });
        }

        // allFree mode: tier is 'pro' for everyone, the stored plan is shown as data, and the only caps are the fair-use numbers.
        // Optional ?projectId= adds that project's tweak count. Off mode: exactly the old body plus allFree:false.
        const extra = result.allFree
            ? {
                storedTier: result.storedTier,
                storedStatus: result.storedStatus,
                storedExpiresAt: result.storedExpiresAt,
                fairUse: await fairUseSnapshot(userId, typeof req.query.projectId === 'string' ? req.query.projectId : null)
            }
            : {};
        res.json({
            success: true,
            tier: result.tier,
            status: result.status,
            expiresAt: result.expiresAt,
            platform: result.platform,
            limits: result.limits,
            allFree: !!result.allFree,
            ...extra
        });

    } catch (error) {
        console.error('[subscriptions/status] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/subscriptions/verify
 * Verify App Store or Play Store receipt
 */
router.post('/verify', async (req, res) => {
    try {
        const { userId, platform, receiptData } = req.body;

        if (!userId || !platform || !receiptData) {
            return res.status(400).json({
                error: 'userId, platform, and receiptData are required'
            });
        }

        if (platform !== 'ios' && platform !== 'android') {
            return res.status(400).json({
                error: 'platform must be "ios" or "android"'
            });
        }

        const result = await verifyReceipt(platform, receiptData, userId);

        if (!result.success) {
            return res.status(result.httpStatus || (result.unavailable ? 501 : 400)).json({
                error: result.error
            });
        }

        if (result.duplicate) {
            return res.json({
                success: true,
                message: result.message,
                duplicate: true
            });
        }

        // A new or renewed plan changes the size of the user's apps' usage caps; do it now, not at the next sweep.
        syncTierLimitsForUser({ supabase, proxyAdmin: req.app.locals.proxyAdmin, userId, getStatus: getSubscriptionStatus }).catch(() => {});

        res.json({
            success: true,
            tier: result.tier,
            expiresAt: result.expiresAt,
            productId: result.productId
        });

    } catch (error) {
        console.error('[subscriptions/verify] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/subscriptions/usage
 * Record usage for a user action
 */
router.post('/usage', async (req, res) => {
    try {
        const { userId, actionType, projectId } = req.body;

        if (!userId || !actionType) {
            return res.status(400).json({
                error: 'userId and actionType are required'
            });
        }

        // Validate action type
        if (!Object.values(ACTION_TYPES).includes(actionType)) {
            return res.status(400).json({
                error: 'Invalid action type',
                validTypes: Object.values(ACTION_TYPES)
            });
        }

        // Check if user can perform this action
        const limitCheck = await checkUsageLimit(userId, actionType, projectId);

        if (!limitCheck.allowed && limitCheck.fairUse) return res.status(429).json(fairUseBody(limitCheck));
        if (!limitCheck.allowed) {
            return res.status(403).json({
                error: limitCheck.error,
                used: limitCheck.used,
                limit: limitCheck.limit,
                remaining: limitCheck.remaining,
                requiresTier: limitCheck.requiresTier,
                currentTier: limitCheck.currentTier
            });
        }

        // Record the usage
        const result = await recordUsage(userId, actionType, projectId);

        if (!result.success) {
            return res.status(500).json({
                error: result.error
            });
        }

        res.json({
            success: true,
            usageId: result.usageId,
            tier: limitCheck.tier,
            used: limitCheck.used,
            limit: limitCheck.limit,
            remaining: limitCheck.remaining,
            unlimited: limitCheck.unlimited
        });

    } catch (error) {
        console.error('[subscriptions/usage] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

/**
 * GET /api/subscriptions/plans
 * Get available subscription plans
 */
router.get('/plans', (req, res) => {
    try {
        // While everything is free there is nothing to buy: one plan, no price, so no client can render a plan comparison.
        if (allFreeEnabled()) {
            const l = allFreeLimits();
            return res.json({
                success: true,
                allFree: true,
                plans: [{
                    tier: 'pro',
                    name: l.name,
                    price: '$0',
                    features: { dailyGenerations: l.dailyGenerations, tweaksPerProject: l.tweaksPerProject, privateProjects: true, priorityQueue: true, collaboration: false }
                }]
            });
        }
        const plans = Object.entries(SUBSCRIPTION_TIERS).map(([tier, info]) => ({
            tier,
            name: info.name,
            price: info.price,
            features: {
                dailyGenerations: info.dailyGenerations === Infinity ? 'Unlimited' : info.dailyGenerations,
                tweaksPerProject: info.tweaksPerProject === Infinity ? 'Unlimited' : info.tweaksPerProject,
                privateProjects: info.canCreatePrivateProjects,
                priorityQueue: info.priorityQueue,
                collaboration: info.collaboration || false
            }
        }));

        res.json({
            success: true,
            plans
        });

    } catch (error) {
        console.error('[subscriptions/plans] Error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

/**
 * POST /api/subscriptions/create-checkout
 * Create a Stripe Checkout Session for subscription upgrade
 */
router.post('/create-checkout', async (req, res) => {
    try {
        // Dormant while VIBEBUILD_ALL_FREE is on: nobody should be charged for features everyone already has. The Stripe code below is untouched.
        if (allFreeEnabled()) {
            return res.status(409).json({ error: 'VibeBuild is free for now. There is nothing to buy.', allFree: true });
        }
        if (!stripe) {
            return res.status(500).json({ error: 'Stripe is not configured' });
        }

        const { userId, email, tier } = req.body;

        if (!userId || !tier) {
            return res.status(400).json({ error: 'userId and tier are required' });
        }

        const priceId = STRIPE_PRICE_IDS[tier];
        if (!priceId) {
            return res.status(400).json({ error: 'Invalid tier' });
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${WEB_APP_URL}/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${WEB_APP_URL}/settings?checkout=cancelled`,
            client_reference_id: userId,
            customer_email: email || undefined,
            metadata: { userId, tier },
            // Lets the webhook rebuild a missing row from the subscription itself when events arrive out of order.
            subscription_data: { metadata: { userId, tier } },
        });

        res.json({ success: true, url: session.url, sessionId: session.id });
    } catch (error) {
        console.error('[subscriptions/create-checkout] Error:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

/**
 * POST /api/subscriptions/stripe-webhook
 * Handle Stripe webhook events
 */
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe is not configured' });
    }

    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('[stripe-webhook] Signature verification failed:', err.message);
        reportFailure('billing:stripe_webhook_signature', new Error('Stripe webhook signature verification failed'));
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        const processor = createStripeEventProcessor({ supabase, api: stripe ? stripeApiFrom(stripe) : null });
        const result = await processor.process(event);
        if (result.outcome === 'applied') console.log(`[stripe-webhook] ${event.type} applied`);
    } catch (error) {
        console.error('[stripe-webhook] Processing error:', error?.message);
        reportFailure('billing:stripe_webhook_processing', new Error('Stripe webhook processing failed'), { event_type: String(event?.type ?? '').slice(0, 60) });
        // 5xx so Stripe retries (it backs off for up to three days). Everything final (applied, skipped, duplicate, unknown type) is 2xx below.
        return res.status(500).json({ error: 'Webhook processing failed' });
    }

    // Any subscription event can change a user's tier: re-apply tiers soon (debounced; the periodic sweep is the backstop).
    req.app.locals.tierSweep?.trigger?.();
    res.json({ received: true });
});

export default router;
