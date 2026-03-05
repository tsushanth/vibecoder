package com.kreativekoala.vibecoder.service

import android.content.Context
import android.util.Log
import com.tiktok.TikTokBusinessSdk

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
}
