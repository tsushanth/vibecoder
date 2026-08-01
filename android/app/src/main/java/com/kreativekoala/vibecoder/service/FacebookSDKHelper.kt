package com.kreativekoala.vibecoder.service

import android.content.Context
import android.util.Log
import com.facebook.FacebookSdk
import com.facebook.appevents.AppEventsConstants
import com.facebook.appevents.AppEventsLogger
import java.math.BigDecimal
import java.util.Currency

object FacebookSDKHelper {
    private const val TAG = "FacebookSDKHelper"
    private const val PREFS = "fb_sdk_helper"
    private const val KEY_REGISTERED = "has_fired_complete_registration"

    private lateinit var appContext: Context

    fun initialize(context: Context) {
        try {
            appContext = context.applicationContext
            FacebookSdk.setAutoLogAppEventsEnabled(true)
            FacebookSdk.setAdvertiserIDCollectionEnabled(true)
            FacebookSdk.sdkInitialize(appContext)
            Log.i(TAG, "Facebook SDK initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize Facebook SDK", e)
        }
    }

    /**
     * Fires `fb_mobile_complete_registration` exactly once per install.
     * Meta App Promotion campaigns optimize on this event for the signup
     * portion of the funnel. Returning Google sign-ins MUST NOT re-fire —
     * SharedPreferences guards against duplicates.
     */
    fun logSignUp(method: String) {
        try {
            val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (prefs.getBoolean(KEY_REGISTERED, false)) {
                Log.d(TAG, "Skipping logSignUp ($method) — already fired this install")
                return
            }
            val logger = AppEventsLogger.newLogger(appContext)
            val params = android.os.Bundle().apply {
                putString(AppEventsConstants.EVENT_PARAM_REGISTRATION_METHOD, method)
            }
            logger.logEvent(AppEventsConstants.EVENT_NAME_COMPLETED_REGISTRATION, params)
            prefs.edit().putBoolean(KEY_REGISTERED, true).apply()
            Log.d(TAG, "Logged sign up: $method")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to log sign up", e)
        }
    }

    fun logPurchase(price: Double, currency: String, productId: String) {
        try {
            val logger = AppEventsLogger.newLogger(appContext)
            logger.logPurchase(BigDecimal.valueOf(price), Currency.getInstance(currency))
            val params = android.os.Bundle().apply {
                putString(AppEventsConstants.EVENT_PARAM_CONTENT_ID, productId)
                putString(AppEventsConstants.EVENT_PARAM_CURRENCY, currency)
            }
            logger.logEvent(AppEventsConstants.EVENT_NAME_SUBSCRIBE, price, params)
            Log.d(TAG, "Logged purchase: $productId $price $currency")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to log purchase", e)
        }
    }

    fun logTrialStarted(productId: String) {
        try {
            val logger = AppEventsLogger.newLogger(appContext)
            val params = android.os.Bundle().apply {
                putString(AppEventsConstants.EVENT_PARAM_CONTENT_ID, productId)
            }
            logger.logEvent(AppEventsConstants.EVENT_NAME_START_TRIAL, params)
            Log.d(TAG, "Logged trial started: $productId")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to log trial started", e)
        }
    }
}
