import express from 'express';
import {
    getSubscriptionStatus,
    verifyReceipt,
    recordUsage,
    checkUsageLimit,
    SUBSCRIPTION_TIERS,
    ACTION_TYPES
} from '../services/subscriptionService.js';

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

export default router;
