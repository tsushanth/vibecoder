package com.kreativekoala.vibecoder.service

import android.content.Context
import android.os.Bundle
import android.util.Log
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.analytics.ktx.analytics
import com.google.firebase.ktx.Firebase

object FirebaseAnalyticsHelper {
    private const val TAG = "FirebaseAnalytics"

    private var firebaseAnalytics: FirebaseAnalytics? = null
    private var isInitialized = false

    fun initialize(context: Context) {
        try {
            firebaseAnalytics = Firebase.analytics
            isInitialized = true
            Log.d(TAG, "Firebase Analytics initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize Firebase Analytics: ${e.message}")
        }
    }

    fun setUserId(userId: String?) {
        firebaseAnalytics?.setUserId(userId)
    }

    fun setUserProperty(name: String, value: String?) {
        firebaseAnalytics?.setUserProperty(name, value)
    }

    // Standard Events

    fun logAppOpen() {
        logEvent(FirebaseAnalytics.Event.APP_OPEN)
    }

    fun logScreenView(screenName: String, screenClass: String? = null) {
        val params = Bundle().apply {
            putString(FirebaseAnalytics.Param.SCREEN_NAME, screenName)
            screenClass?.let { putString(FirebaseAnalytics.Param.SCREEN_CLASS, it) }
        }
        logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, params)
    }

    fun logSignUp(method: String) {
        val params = Bundle().apply {
            putString(FirebaseAnalytics.Param.METHOD, method)
        }
        logEvent(FirebaseAnalytics.Event.SIGN_UP, params)
    }

    fun logLogin(method: String) {
        val params = Bundle().apply {
            putString(FirebaseAnalytics.Param.METHOD, method)
        }
        logEvent(FirebaseAnalytics.Event.LOGIN, params)
    }

    // Onboarding Events

    fun logOnboardingStarted() {
        logEvent("onboarding_started")
    }

    fun logOnboardingCompleted() {
        logEvent("onboarding_completed")
    }

    fun logOnboardingSkipped(atPage: Int) {
        val params = Bundle().apply {
            putInt("at_page", atPage)
        }
        logEvent("onboarding_skipped", params)
    }

    // Subscription Events

    fun logPaywallViewed(source: String? = null) {
        val params = Bundle().apply {
            source?.let { putString("source", it) }
        }
        logEvent("paywall_viewed", params)
    }

    fun logSubscriptionStarted(productId: String, isTrial: Boolean = false) {
        val params = Bundle().apply {
            putString("product_id", productId)
            putBoolean("is_trial", isTrial)
        }
        logEvent("subscription_started", params)
    }

    fun logPurchaseCompleted(productId: String, revenue: Double? = null) {
        val params = Bundle().apply {
            putString("product_id", productId)
            revenue?.let { putDouble(FirebaseAnalytics.Param.VALUE, it) }
            putString(FirebaseAnalytics.Param.CURRENCY, "USD")
        }
        logEvent(FirebaseAnalytics.Event.PURCHASE, params)
    }

    // App Generation Events

    fun logGenerationStarted(hasReferenceImage: Boolean = false) {
        val params = Bundle().apply {
            putBoolean("has_reference_image", hasReferenceImage)
        }
        logEvent("generation_started", params)
    }

    fun logGenerationCompleted(durationSeconds: Long? = null) {
        val params = Bundle().apply {
            durationSeconds?.let { putLong("duration_seconds", it) }
        }
        logEvent("generation_completed", params)
    }

    fun logGenerationFailed(error: String? = null) {
        val params = Bundle().apply {
            error?.let { putString("error", it) }
        }
        logEvent("generation_failed", params)
    }

    // Project Events

    fun logProjectSaved(projectId: String? = null) {
        val params = Bundle().apply {
            projectId?.let { putString("project_id", it) }
        }
        logEvent("project_saved", params)
    }

    fun logProjectShared() {
        logEvent("project_shared")
    }

    fun logProjectDeleted() {
        logEvent("project_deleted")
    }

    fun logBrowseExplored() {
        logEvent("browse_explored")
    }

    fun logLivePreviewOpened() {
        logEvent("live_preview_opened")
    }

    // Usage Events

    fun logDailyLimitReached() {
        logEvent("daily_limit_reached")
    }

    // Core Logging

    private fun logEvent(eventName: String, params: Bundle? = null) {
        if (!isInitialized) {
            Log.w(TAG, "Firebase Analytics not initialized, skipping event: $eventName")
            return
        }
        try {
            firebaseAnalytics?.logEvent(eventName, params)
            Log.d(TAG, "Logged event: $eventName")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to log event $eventName: ${e.message}")
        }
    }
}
