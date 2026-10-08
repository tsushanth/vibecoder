package com.kreativekoala.vibecoder.ui.paywall

/** The free-plan build limit, as pure rules (the counter itself lives in the app's preferences). */
object GenerationLimit {
    const val FREE_LIMIT = 30

    /**
     * The count to keep. The server's project count is a floor for the local counter, so clearing the app's data (which resets
     * the local counter to 0) does not reset the free limit for a signed-in user who has already built that many apps.
     */
    fun merge(local: Int, server: Int): Int = maxOf(local, server)

    /** The hard paywall: not a subscriber and the limit is reached. */
    fun isOverLimit(premium: Boolean, count: Int, limit: Int = FREE_LIMIT): Boolean = !premium && count >= limit

    /** The soft upsell inside the build chat starts one build before the limit. */
    fun showsUpsell(premium: Boolean, count: Int, limit: Int = FREE_LIMIT): Boolean = !premium && count >= limit - 1

    /** After onboarding only people who do not already subscribe are offered the paywall. */
    fun showsPostOnboardingPaywall(premium: Boolean): Boolean = !premium
}
