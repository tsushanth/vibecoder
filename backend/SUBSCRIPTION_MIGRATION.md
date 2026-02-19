# VibeCoder Backend: Coins to Subscriptions Migration

This document outlines the changes made to migrate VibeCoder from a coin-based monetization system to a subscription-based model.

## Overview

The backend has been updated to use subscription tiers (Free, Pro, Team) instead of coins for monetization. Users are now limited by their subscription tier rather than by coin balances.

## Subscription Tiers

### Free Tier
- 3 generations per day
- 3 tweaks per project
- Public projects only
- No priority queue

### Pro Tier ($9.99/month)
- Unlimited generations
- Unlimited tweaks
- Private projects allowed
- Priority queue access

### Team Tier ($29.99/month)
- Everything in Pro
- Collaboration features (future enhancement)

## Files Created

### 1. `/backend/services/subscriptionService.js`
Core subscription management service with the following functions:

- `getSubscriptionStatus(userId)` - Get user's current subscription tier and status
- `checkUsageLimit(userId, actionType, projectId)` - Check if user can perform an action
- `recordUsage(userId, actionType, projectId)` - Record usage for tracking
- `verifyReceipt(platform, receiptData, userId)` - Verify App Store/Play Store receipts

**Exports:**
- `SUBSCRIPTION_TIERS` - Configuration object for all tiers
- `ACTION_TYPES` - Available action types (generation, tweak, fork, create_private)

### 2. `/backend/routes/subscriptions.routes.js`
API endpoints for subscription management:

- `GET /api/subscriptions/status?userId={id}` - Get user's subscription status
- `POST /api/subscriptions/verify` - Verify IAP receipt
- `POST /api/subscriptions/usage` - Record and check usage limits
- `GET /api/subscriptions/plans` - Get available subscription plans

## Files Modified

### 3. `/backend/server.js`
**Changes:**
- Removed: `import coinsRoutes from './routes/coins.routes.js'`
- Added: `import subscriptionsRoutes from './routes/subscriptions.routes.js'`
- Replaced: `app.use('/api/coins', coinsRoutes)` with `app.use('/api/subscriptions', subscriptionsRoutes)`

### 4. `/backend/routes/projects.routes.js`
**Added Imports:**
```javascript
import { checkUsageLimit, recordUsage, ACTION_TYPES } from '../services/subscriptionService.js';
```

**Modified Endpoints:**

#### POST /api/projects/generate
- Added subscription limit check before generation
- Records usage after successful generation
- Returns usage stats in error responses when limit exceeded

**Before:**
```javascript
if (!checkRateLimit(userId)) {
    return res.status(429).json({ error: 'Rate limit exceeded...' });
}
```

**After:**
```javascript
if (!checkRateLimit(userId)) {
    return res.status(429).json({ error: 'Rate limit exceeded...' });
}

// Check subscription usage limit
if (userId) {
    const limitCheck = await checkUsageLimit(userId, ACTION_TYPES.generation);
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
}
```

#### POST /api/projects/save
- Added check for private project creation (requires Pro/Team tier)

#### POST /api/projects/:id/tweak
- Removed all coin-spending logic
- Removed free tweak counter management
- Added subscription limit check
- Records usage after successful tweak
- Removed coin refund logic on errors
- Returns subscription tier info in response

**Before (Coin System):**
```javascript
// Check free tweaks or spend coins
const freeTweaks = project.free_tweaks_remaining ?? FREE_TWEAKS_DEFAULT;
let coinSpent = false;

if (freeTweaks <= 0) {
    // Spend coins via RPC...
    if (!spendResult.success) {
        return res.status(400).json({
            error: 'Insufficient coins',
            balance: spendResult.balance || 0,
            tweakCost: TWEAK_COST
        });
    }
    coinSpent = true;
}
```

**After (Subscription System):**
```javascript
// Check subscription usage limit for tweaks
const limitCheck = await checkUsageLimit(userId, ACTION_TYPES.tweak, id);
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
```

#### POST /api/projects/:id/fork
- Removed coin-spending logic
- Removed creator share calculation
- Added subscription check (forks allowed for all tiers)
- Records usage for tracking
- Simplified response (no coin/balance info)

**Before:**
```javascript
// Spend coins with creator share
const { data: spendResult } = await supabase.rpc('spend_coins', {
    p_user_id: userId,
    p_amount: FORK_COST,
    p_creator_id: original.creator_id,
    ...
});

res.json({
    success: true,
    projectId: forkId,
    coinsSpent: FORK_COST,
    creatorShare: spendResult.creator_share,
    newBalance: spendResult.new_balance
});
```

**After:**
```javascript
// Check subscription (forks allowed for all)
const limitCheck = await checkUsageLimit(userId, ACTION_TYPES.fork);
if (!limitCheck.allowed) {
    return res.status(403).json({
        error: limitCheck.error,
        requiresTier: limitCheck.requiresTier,
        currentTier: limitCheck.currentTier
    });
}

await recordUsage(userId, ACTION_TYPES.fork, id);

res.json({
    success: true,
    projectId: forkId,
    title: forkTitle,
    tier: limitCheck.tier
});
```

#### GET /api/projects/:id/versions
- Removed `freeTweaksRemaining` and `tweakCost` from response

## Database Requirements

To support subscriptions, the following Supabase tables should be created:

### `user_subscriptions` table
```sql
CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free', -- 'free', 'pro', 'team'
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'expired', 'cancelled'
    platform TEXT, -- 'ios', 'android', null for web
    product_id TEXT,
    receipt_data TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);
```

### `subscription_usage` table
```sql
CREATE TABLE subscription_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL, -- 'generation', 'tweak', 'fork'
    project_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_subscription_usage_user_id ON subscription_usage(user_id);
CREATE INDEX idx_subscription_usage_action_type ON subscription_usage(action_type);
CREATE INDEX idx_subscription_usage_project_id ON subscription_usage(project_id);
CREATE INDEX idx_subscription_usage_created_at ON subscription_usage(created_at);
```

## Files Deprecated (Not Deleted)

The following files are no longer used but remain in the codebase for reference:
- `/backend/routes/coins.routes.js`
- `/backend/services/coinService.js`

These can be safely removed once the migration is confirmed successful.

## API Response Changes

### Error Responses
When a user exceeds their subscription limits, the API now returns:

```json
{
    "error": "Free tier limited to 3 generations per day",
    "used": 3,
    "limit": 3,
    "remaining": 0,
    "requiresTier": "pro",
    "currentTier": "free"
}
```

### Success Responses
Tweak endpoint now returns:
```json
{
    "type": "result",
    "success": true,
    "bundle": "...",
    "tier": "pro",
    "used": 5,
    "limit": Infinity,
    "remaining": Infinity,
    "unlimited": true
}
```

## Migration Checklist

- [x] Create subscription service with tier management
- [x] Create subscription routes for status, verification, usage
- [x] Update server.js to use subscription routes
- [x] Update projects/generate endpoint to check subscription limits
- [x] Update projects/save endpoint to check private project permission
- [x] Update projects/tweak endpoint to use subscriptions
- [x] Update projects/fork endpoint to use subscriptions
- [x] Remove coin-related code from projects endpoints
- [x] Update API responses to include subscription info
- [ ] Create database tables (user_subscriptions, subscription_usage)
- [ ] Implement App Store receipt validation
- [ ] Implement Play Store receipt validation
- [ ] Migrate existing users to free tier
- [ ] Update mobile app to use subscription endpoints
- [ ] Update frontend to display subscription status
- [ ] Add subscription management UI
- [ ] Test all subscription tiers
- [ ] Remove deprecated coin files

## Testing

To test the subscription system:

1. **Free Tier Testing:**
   - Generate 3 projects in one day, verify 4th is blocked
   - Tweak a project 3 times, verify 4th is blocked
   - Try to create a private project, verify it's blocked

2. **Pro Tier Testing:**
   - Generate unlimited projects
   - Tweak projects unlimited times
   - Create private projects successfully

3. **Receipt Verification:**
   - Test iOS receipt verification
   - Test Android receipt verification
   - Test duplicate receipt handling

## Notes

- The subscription service uses Supabase for data storage
- Receipt verification is currently stubbed and needs production implementation
- Free tier users default to no subscription record in the database
- Expired subscriptions automatically downgrade to free tier
- Usage limits reset daily for generations, per-project for tweaks
