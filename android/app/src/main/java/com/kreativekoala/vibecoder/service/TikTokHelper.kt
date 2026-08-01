package com.kreativekoala.vibecoder.service

import android.content.Context
import android.util.Log
import com.tiktok.TikTokBusinessSdk
import org.json.JSONObject

object TikTokHelper {
    private const val TAG = "TikTokHelper"
    private const val APP_ID = "7612077628498558984"

    fun initialize(context: Context) {
        try {
            val config = TikTokBusinessSdk.TTConfig(context.applicationContext)
                .setAppId(APP_ID)
                .setLogLevel(TikTokBusinessSdk.LogLevel.INFO)

            TikTokBusinessSdk.initializeSdk(config)
            Log.i(TAG, "TikTok SDK initialized with appId: $APP_ID")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize TikTok SDK", e)
        }
    }

    fun trackEvent(eventName: String) {
        try {
            TikTokBusinessSdk.trackEvent(eventName)
            Log.d(TAG, "Tracked event: $eventName")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to track event: $eventName", e)
        }
    }

    fun trackPurchase(productId: String, price: Double, currency: String = "USD") {
        try {
            val props = JSONObject().apply {
                put("currency", currency)
                put("value", price)
                put("content_id", productId)
                put("content_type", "product")
                put("description", productId)
            }
            // "Subscribe" is the standard TikTok event for subscription purchases
            TikTokBusinessSdk.trackEvent("Subscribe", props)
            Log.d(TAG, "Tracked Subscribe: $productId @ $price $currency")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to track purchase event", e)
        }
    }
}
