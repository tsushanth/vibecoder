package com.kreativekoala.vibecoder.util

/**
 * The single switch for the paid plans. While [ALL_FREE] is true the app is completely free: no paywall (after onboarding, at a
 * build limit, or at launch), no upgrade prompts, no plan labels, and no local build caps. The billing code (RevenueCat, the paywall
 * screens, the limit rules) stays in place behind this flag; set it to false to bring Pro back.
 */
object Monetization {
    const val ALL_FREE = true
}
