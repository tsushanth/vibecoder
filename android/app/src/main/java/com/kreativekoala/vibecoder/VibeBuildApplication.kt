package com.kreativekoala.vibecoder

import android.app.Application
import com.facebook.appevents.AppEventsLogger
import com.kreativekoala.vibecoder.service.FirebaseAnalyticsHelper
import com.kreativekoala.vibecoder.service.TikTokHelper
import com.kreativekoala.vibecoder.util.NotificationHelper
import com.kreativekoala.paywallkit.manager.ExperimentManager
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class VibeBuildApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannel(this)

        // Initialize Facebook SDK for Meta Ads attribution
        AppEventsLogger.activateApp(this)

        // Initialize Firebase Analytics for Google Ads conversion tracking
        FirebaseAnalyticsHelper.initialize(this)

        // Initialize TikTok Events SDK for install attribution
        TikTokHelper.initialize(this)

        // Initialize PaywallKit experiment manager
        ExperimentManager.init(this)

        // Initialize RevenueCat
        Purchases.logLevel = if (BuildConfig.DEBUG) LogLevel.DEBUG else LogLevel.WARN
        Purchases.configure(
            PurchasesConfiguration.Builder(this, "goog_ukOquwcrZdyypGtQDKkJDEeoBuY")
                .build()
        )
    }
}
