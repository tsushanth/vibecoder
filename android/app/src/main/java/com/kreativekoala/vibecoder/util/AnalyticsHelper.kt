package com.kreativekoala.vibecoder.util

import android.os.Bundle
import com.google.firebase.analytics.FirebaseAnalytics
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AnalyticsHelper @Inject constructor(
    private val firebaseAnalytics: FirebaseAnalytics
) {
    // Screen tracking
    fun logScreenView(screenName: String, screenClass: String? = null) {
        firebaseAnalytics.logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, Bundle().apply {
            putString(FirebaseAnalytics.Param.SCREEN_NAME, screenName)
            screenClass?.let { putString(FirebaseAnalytics.Param.SCREEN_CLASS, it) }
        })
    }

    // Authentication events
    fun logLogin(method: String) {
        firebaseAnalytics.logEvent(FirebaseAnalytics.Event.LOGIN, Bundle().apply {
            putString(FirebaseAnalytics.Param.METHOD, method)
        })
    }

    fun logSignUp(method: String) {
        firebaseAnalytics.logEvent(FirebaseAnalytics.Event.SIGN_UP, Bundle().apply {
            putString(FirebaseAnalytics.Param.METHOD, method)
        })
    }

    // Project generation events
    fun logGenerationStart() {
        firebaseAnalytics.logEvent("generation_start", null)
    }

    fun logGenerationComplete(durationSeconds: Long? = null) {
        firebaseAnalytics.logEvent("generation_complete", Bundle().apply {
            durationSeconds?.let { putLong("duration_seconds", it) }
        })
    }

    fun logGenerationError(errorMessage: String?) {
        firebaseAnalytics.logEvent("generation_error", Bundle().apply {
            errorMessage?.let { putString("error_message", it.take(100)) }
        })
    }

    // Project actions
    fun logProjectSave(projectId: String?) {
        firebaseAnalytics.logEvent("project_save", Bundle().apply {
            projectId?.let { putString("project_id", it) }
        })
    }

    fun logProjectView(projectId: String) {
        firebaseAnalytics.logEvent("project_view", Bundle().apply {
            putString("project_id", projectId)
        })
    }

    fun logProjectDownload(projectId: String) {
        firebaseAnalytics.logEvent("project_download", Bundle().apply {
            putString("project_id", projectId)
        })
    }

    fun logProjectPublish(projectId: String) {
        firebaseAnalytics.logEvent("project_publish", Bundle().apply {
            putString("project_id", projectId)
        })
    }

    // Subscription events
    fun logViewSubscriptionPlans() {
        firebaseAnalytics.logEvent("view_subscription_plans", null)
    }

    fun logPurchaseStart(productId: String) {
        firebaseAnalytics.logEvent("purchase_start", Bundle().apply {
            putString(FirebaseAnalytics.Param.ITEM_ID, productId)
        })
    }

    fun logPurchaseComplete(productId: String, tier: String) {
        firebaseAnalytics.logEvent(FirebaseAnalytics.Event.PURCHASE, Bundle().apply {
            putString(FirebaseAnalytics.Param.ITEM_ID, productId)
            putString("subscription_tier", tier)
        })
    }

    // User properties
    fun setUserProperty(name: String, value: String?) {
        firebaseAnalytics.setUserProperty(name, value)
    }

    fun setUserId(userId: String?) {
        firebaseAnalytics.setUserId(userId)
    }

    fun setSubscriptionTier(tier: String) {
        setUserProperty("subscription_tier", tier)
    }
}
