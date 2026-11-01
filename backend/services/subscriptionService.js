import { supabase } from '../config/database.js';
import { ENTITLED_STATUSES, UUID_RE } from '../lib/entitlementState.js';
import { reportFailure } from '../lib/failureReporter.js';
import { revenueCatRestConfigured, syncUserFromRevenueCat } from './revenueCat.js';

// Subscription tiers and limits
const SUBSCRIPTION_TIERS = {
    free: {
        name: 'Free',
        dailyGenerations: 10,
        tweaksPerProject: 3,
        canCreatePrivateProjects: false,
        priorityQueue: false,
        price: '$0'
    },
    pro: {
        name: 'Pro',
        dailyGenerations: Infinity,
        tweaksPerProject: Infinity,
        canCreatePrivateProjects: true,
        priorityQueue: true,
        price: '$9.99/month'
    },
    team: {
        name: 'Team',
        dailyGenerations: Infinity,
        tweaksPerProject: Infinity,
        canCreatePrivateProjects: true,
        priorityQueue: true,
        collaboration: true,
        price: '$29.99/month'
    }
};

// Action types and their tier requirements
const ACTION_TYPES = {
    generation: 'generation',
    tweak: 'tweak',
    fork: 'fork',
    createPrivate: 'create_private'
};

/**
 * Get user's subscription status
 * @param {string} userId - User ID
 * @returns {object} Subscription status
 */
export async function getSubscriptionStatus(userId) {
    try {
        if (!userId) {
            return {
                success: false,
                error: 'userId is required'
            };
        }

        // Demo user bypass - always return free tier
        if (userId === 'demo-user') {
            console.log('[subscription] Demo user detected, returning free tier');
            return {
                success: true,
                tier: 'free',
                status: 'active',
                expiresAt: null,
                limits: SUBSCRIPTION_TIERS.free
            };
        }

        const { data, error } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('user_id', userId)
            .single();

        // User has no subscription record, default to free tier
        if (error && error.code === 'PGRST116') {
            return {
                success: true,
                tier: 'free',
                status: 'active',
                expiresAt: null,
                limits: SUBSCRIPTION_TIERS.free
            };
        }

        if (error) {
            console.error('[subscription] Error fetching status:', error);
            // Default to free tier on error instead of failing
            console.log('[subscription] Defaulting to free tier due to error');
            return {
                success: true,
                tier: 'free',
                status: 'active',
                expiresAt: null,
                limits: SUBSCRIPTION_TIERS.free
            };
        }

        // Check if subscription is expired
        const now = new Date();
        const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
        const isExpired = expiresAt && expiresAt < now;

        // Entitled statuses: active, trialing, and past_due (bounded grace: the webhooks stamp expires_at, see lib/entitlementState.js).
        const effectiveTier = (isExpired || !ENTITLED_STATUSES.has(data.status)) ? 'free' : data.tier;

        return {
            success: true,
            tier: effectiveTier,
            status: isExpired ? 'expired' : data.status,
            expiresAt: data.expires_at,
            platform: data.platform,
            limits: SUBSCRIPTION_TIERS[effectiveTier] || SUBSCRIPTION_TIERS.free,
            originalTier: data.tier
        };

    } catch (error) {
        console.error('[subscription] getSubscriptionStatus error:', error);
        return {
            success: false,
            error: 'Internal server error'
        };
    }
}

/**
 * Check if user can perform an action based on subscription tier and usage
 * @param {string} userId - User ID
 * @param {string} actionType - Type of action (generation, tweak, fork, create_private)
 * @param {string} projectId - Project ID (for project-specific limits like tweaks)
 * @returns {object} Can perform action status
 */
export async function checkUsageLimit(userId, actionType, projectId = null) {
    try {
        if (!userId || !actionType) {
            return {
                allowed: false,
                error: 'userId and actionType are required'
            };
        }

        // Get subscription status
        const subStatus = await getSubscriptionStatus(userId);
        if (!subStatus.success) {
            return {
                allowed: false,
                error: subStatus.error
            };
        }

        const { tier, limits } = subStatus;

        // Check tier-specific permissions
        if (actionType === ACTION_TYPES.createPrivate) {
            if (!limits.canCreatePrivateProjects) {
                return {
                    allowed: false,
                    error: 'Private projects require Pro or Team subscription',
                    requiresTier: 'pro',
                    currentTier: tier
                };
            }
            return { allowed: true, tier };
        }

        // Pro and Team tiers have unlimited usage
        if (tier === 'pro' || tier === 'team') {
            return {
                allowed: true,
                tier,
                unlimited: true
            };
        }

        // Free tier usage limits
        if (tier === 'free') {
            // Check generations per day
            if (actionType === ACTION_TYPES.generation) {
                // Demo user or when usage table doesn't exist - allow limited generations
                if (userId === 'demo-user') {
                    console.log('[subscription] Demo user - allowing generation with free tier limits');
                    return {
                        allowed: true,
                        tier,
                        used: 0,
                        limit: limits.dailyGenerations,
                        remaining: limits.dailyGenerations
                    };
                }

                const { data: usageData, error: usageError } = await supabase
                    .from('subscription_usage')
                    .select('count')
                    .eq('user_id', userId)
                    .eq('action_type', 'generation')
                    .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
                    .lt('created_at', new Date(new Date().setHours(23, 59, 59, 999)).toISOString());

                if (usageError) {
                    console.error('[subscription] Error checking generation usage:', usageError);
                    // Allow action when usage tracking fails (for demo/development)
                    console.log('[subscription] Allowing action due to usage check error');
                    return {
                        allowed: true,
                        tier,
                        used: 0,
                        limit: limits.dailyGenerations,
                        remaining: limits.dailyGenerations
                    };
                }

                const todayGenerations = usageData?.length || 0;
                const remaining = limits.dailyGenerations - todayGenerations;

                if (todayGenerations >= limits.dailyGenerations) {
                    return {
                        allowed: false,
                        error: `Free tier limited to ${limits.dailyGenerations} generations per day`,
                        used: todayGenerations,
                        limit: limits.dailyGenerations,
                        remaining: 0,
                        requiresTier: 'pro',
                        currentTier: tier
                    };
                }

                return {
                    allowed: true,
                    tier,
                    used: todayGenerations,
                    limit: limits.dailyGenerations,
                    remaining
                };
            }

            // Check tweaks per project
            if (actionType === ACTION_TYPES.tweak) {
                if (!projectId) {
                    return {
                        allowed: false,
                        error: 'projectId is required for tweak actions'
                    };
                }

                // Demo user - allow limited tweaks
                if (userId === 'demo-user') {
                    console.log('[subscription] Demo user - allowing tweak with free tier limits');
                    return {
                        allowed: true,
                        tier,
                        used: 0,
                        limit: limits.tweaksPerProject,
                        remaining: limits.tweaksPerProject
                    };
                }

                const { data: usageData, error: usageError } = await supabase
                    .from('subscription_usage')
                    .select('count')
                    .eq('user_id', userId)
                    .eq('action_type', 'tweak')
                    .eq('project_id', projectId);

                if (usageError) {
                    console.error('[subscription] Error checking tweak usage:', usageError);
                    // Allow action when usage tracking fails (for demo/development)
                    console.log('[subscription] Allowing tweak due to usage check error');
                    return {
                        allowed: true,
                        tier,
                        used: 0,
                        limit: limits.tweaksPerProject,
                        remaining: limits.tweaksPerProject
                    };
                }

                const projectTweaks = usageData?.length || 0;
                const remaining = limits.tweaksPerProject - projectTweaks;

                if (projectTweaks >= limits.tweaksPerProject) {
                    return {
                        allowed: false,
                        error: `Free tier limited to ${limits.tweaksPerProject} tweaks per project`,
                        used: projectTweaks,
                        limit: limits.tweaksPerProject,
                        remaining: 0,
                        requiresTier: 'pro',
                        currentTier: tier
                    };
                }

                return {
                    allowed: true,
                    tier,
                    used: projectTweaks,
                    limit: limits.tweaksPerProject,
                    remaining
                };
            }

            // Fork is allowed for free tier
            if (actionType === ACTION_TYPES.fork) {
                return { allowed: true, tier };
            }
        }

        return {
            allowed: false,
            error: 'Invalid action type or tier'
        };

    } catch (error) {
        console.error('[subscription] checkUsageLimit error:', error);
        return {
            allowed: false,
            error: 'Internal server error'
        };
    }
}

/**
 * Record usage for a user action
 * @param {string} userId - User ID
 * @param {string} actionType - Type of action
 * @param {string} projectId - Project ID (optional)
 * @returns {object} Record status
 */
export async function recordUsage(userId, actionType, projectId = null) {
    try {
        if (!userId || !actionType) {
            return {
                success: false,
                error: 'userId and actionType are required'
            };
        }

        // Demo user - skip database recording
        if (userId === 'demo-user') {
            console.log(`[subscription] Demo user - skipping usage recording: action=${actionType}, project=${projectId || 'none'}`);
            return {
                success: true,
                usageId: 'demo-usage-id'
            };
        }

        const { data, error } = await supabase
            .from('subscription_usage')
            .insert({
                user_id: userId,
                action_type: actionType,
                project_id: projectId,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            console.error('[subscription] Error recording usage:', error);
            // Don't fail the request if usage recording fails
            console.log('[subscription] Continuing despite usage recording error');
            return {
                success: true,
                usageId: 'error-fallback-id'
            };
        }

        console.log(`[subscription] Recorded usage: user=${userId}, action=${actionType}, project=${projectId || 'none'}`);

        return {
            success: true,
            usageId: data.id
        };

    } catch (error) {
        console.error('[subscription] recordUsage error:', error);
        return {
            success: false,
            error: 'Internal server error'
        };
    }
}

/**
 * "Verify" for mobile purchases. A receipt string from the client is NEVER trusted and never read: the answer comes from
 * RevenueCat's REST API, asked about `userId` as the RevenueCat app user id (so the app must have called Purchases.logIn with the
 * Supabase user id first). It re-reads what the store says that account holds and writes the same user_subscriptions row the
 * RevenueCat webhook writes, so it is a repair/"sync now" path, not the primary one (the webhook is).
 *
 * Needs the server secret REVENUECAT_SECRET_API_KEY. While it is unset (today's production) this stays the old 501 "unavailable"
 * answer and touches nothing: nothing grants a tier from a receipt string, and the webhook path still covers purchases.
 * TODO(owner): set REVENUECAT_SECRET_API_KEY on Fly to turn this on; without it, RevenueCat TRANSFER events (anonymous -> logged-in
 * id) cannot be resolved either.
 * @returns {object} { success, tier?, expiresAt?, productId?, duplicate?, unavailable?, httpStatus?, error? }
 */
export async function verifyReceipt(platform, receiptData, userId) {
    if (!platform || !receiptData || !userId) {
        return { success: false, error: 'platform, receiptData, and userId are required' };
    }
    if (!revenueCatRestConfigured()) {
        return { success: false, unavailable: true, error: 'Store receipt verification is not available' };
    }
    if (!UUID_RE.test(String(userId))) return { success: false, error: 'userId must be the account id' };
    try {
        const r = await syncUserFromRevenueCat(supabase, userId);
        if (r.outcome === 'applied' && r.entitlement?.active) {
            return { success: true, tier: r.entitlement.tier, expiresAt: r.entitlement.expiresAtMs ? new Date(r.entitlement.expiresAtMs).toISOString() : null, productId: r.entitlement.productId };
        }
        if (r.reason === 'other_active_source') return { success: true, duplicate: true, message: 'Account already has an active subscription' };
        return { success: false, error: 'No active store subscription found for this account' };
    } catch {
        reportFailure('billing:revenuecat_verify', new Error('RevenueCat verify failed'));
        return { success: false, httpStatus: 502, error: 'Could not reach the purchase provider' };
    }
}

export { SUBSCRIPTION_TIERS, ACTION_TYPES };
