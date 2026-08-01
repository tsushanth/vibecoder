import express from 'express';
import Stripe from 'stripe';
import { supabase } from '../config/database.js';
import {
    getSubscriptionStatus,
    verifyReceipt,
    recordUsage,
    checkUsageLimit,
    SUBSCRIPTION_TIERS,
    ACTION_TYPES
} from '../services/subscriptionService.js';

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

        res.json({
            success: true,
            tier: result.tier,
            status: result.status,
            expiresAt: result.expiresAt,
            platform: result.platform,
            limits: result.limits
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
            return res.status(400).json({
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
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = session.client_reference_id || session.metadata?.userId;
                const tier = session.metadata?.tier || 'pro';

                if (userId) {
                    await supabase.from('user_subscriptions').upsert({
                        user_id: userId,
                        tier,
                        status: 'active',
                        platform: 'web',
                        product_id: session.subscription,
                        receipt_data: session.id,
                        expires_at: null,
                        updated_at: new Date().toISOString(),
                    }, { onConflict: 'user_id' });

                    console.log(`[stripe-webhook] Subscription activated: user=${userId}, tier=${tier}`);
                }
                break;
            }

            case 'customer.subscription.deleted':
            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                const { data: sub } = await supabase
                    .from('user_subscriptions')
                    .select('user_id')
                    .eq('product_id', subscription.id)
                    .single();

                if (sub) {
                    const isActive = subscription.status === 'active';
                    await supabase.from('user_subscriptions').update({
                        status: isActive ? 'active' : 'cancelled',
                        tier: isActive ? undefined : 'free',
                        expires_at: subscription.current_period_end
                            ? new Date(subscription.current_period_end * 1000).toISOString()
                            : null,
                        updated_at: new Date().toISOString(),
                    }).eq('user_id', sub.user_id);

                    console.log(`[stripe-webhook] Subscription ${subscription.status}: user=${sub.user_id}`);
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                const { data: sub } = await supabase
                    .from('user_subscriptions')
                    .select('user_id')
                    .eq('product_id', invoice.subscription)
                    .single();

                if (sub) {
                    await supabase.from('user_subscriptions').update({
                        status: 'past_due',
                        updated_at: new Date().toISOString(),
                    }).eq('user_id', sub.user_id);
                }
                break;
            }
        }
    } catch (error) {
        console.error('[stripe-webhook] Processing error:', error);
    }

    res.json({ received: true });
});

export default router;
