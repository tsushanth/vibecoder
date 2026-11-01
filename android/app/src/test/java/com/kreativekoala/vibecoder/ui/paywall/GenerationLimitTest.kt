package com.kreativekoala.vibecoder.ui.paywall

import org.junit.Assert.*
import org.junit.Test

class GenerationLimitTest {
    @Test fun serverCountIsAFloor_neverLowersTheLocalCount() {
        assertEquals(30, GenerationLimit.merge(local = 0, server = 30))   // app data cleared, server still remembers
        assertEquals(12, GenerationLimit.merge(local = 12, server = 5))   // deleted projects do not lower it
        assertEquals(7, GenerationLimit.merge(local = 7, server = 7))
        assertEquals(4, GenerationLimit.merge(local = 4, server = -1))    // a bad server value is ignored
    }

    @Test fun hardPaywallAtTheLimitForNonSubscribersOnly() {
        assertFalse(GenerationLimit.isOverLimit(premium = false, count = 29, allFree = false))
        assertTrue(GenerationLimit.isOverLimit(premium = false, count = 30, allFree = false))
        assertTrue(GenerationLimit.isOverLimit(premium = false, count = 31, allFree = false))
        assertFalse(GenerationLimit.isOverLimit(premium = true, count = 500, allFree = false))
    }

    @Test fun upsellStartsOneBuildBeforeTheLimit() {
        assertFalse(GenerationLimit.showsUpsell(premium = false, count = 28, allFree = false))
        assertTrue(GenerationLimit.showsUpsell(premium = false, count = 29, allFree = false))
        assertTrue(GenerationLimit.showsUpsell(premium = false, count = 30, allFree = false))
        assertFalse(GenerationLimit.showsUpsell(premium = true, count = 29, allFree = false))
    }

    @Test fun subscribersSkipThePaywallAfterOnboarding() {
        assertTrue(GenerationLimit.showsPostOnboardingPaywall(premium = false, allFree = false))
        assertFalse(GenerationLimit.showsPostOnboardingPaywall(premium = true, allFree = false))
    }

    @Test fun nothingIsGatedWhileTheAppIsAllFree() {
        assertTrue(com.kreativekoala.vibecoder.util.Monetization.ALL_FREE)
        assertFalse(GenerationLimit.isOverLimit(premium = false, count = 10_000))
        assertFalse(GenerationLimit.showsUpsell(premium = false, count = 10_000))
        assertFalse(GenerationLimit.showsPostOnboardingPaywall(premium = false))
    }

    @Test fun theActivityConstantIsTheSameLimit() {
        assertEquals(GenerationLimit.FREE_LIMIT, com.kreativekoala.vibecoder.MainActivity.FREE_GENERATION_LIMIT)
    }
}
