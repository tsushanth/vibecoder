package com.kreativekoala.vibecoder

import android.app.Application
import com.facebook.appevents.AppEventsLogger
import com.kreativekoala.vibecoder.service.FacebookSDKHelper
import com.kreativekoala.vibecoder.service.FirebaseAnalyticsHelper
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.service.RealPurchasesGateway
import com.kreativekoala.vibecoder.service.RevenueCatIdentitySync
import com.kreativekoala.vibecoder.service.TikTokHelper
import com.kreativekoala.vibecoder.util.NotificationHelper
import com.kreativekoala.ratingkit.RatingKit
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class VibeBuildApplication : Application() {
    @Inject lateinit var authRepository: AuthRepository

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate() {
        super.onCreate()
        FailureReporter.init(this, "vibebuild", "afr_271ab956be760e9f9b82ef912577ed22", BuildConfig.VERSION_NAME)
        NotificationHelper.createChannel(this)

        // Initialize Facebook SDK for Meta Ads attribution
        AppEventsLogger.activateApp(this)
        FacebookSDKHelper.initialize(this)

        // Initialize Firebase Analytics for Google Ads conversion tracking
        FirebaseAnalyticsHelper.initialize(this)

        // Initialize TikTok Events SDK for install attribution
        TikTokHelper.initialize(this)

        // Initialize RatingKit
        RatingKit.init(this, appId = "vibebuild")

        // Initialize RevenueCat
        Purchases.logLevel = if (BuildConfig.DEBUG) LogLevel.DEBUG else LogLevel.WARN
        Purchases.configure(
            PurchasesConfiguration.Builder(this, "goog_ukOquwcrZdyypGtQDKkJDEeoBuY")
                .build()
        )

        // Identify RevenueCat as the signed-in Supabase user (covers email, Google and a restored session), and reset on sign-out.
        val identity = RevenueCatIdentitySync(RealPurchasesGateway())
        appScope.launch {
            authRepository.observeUserId().collectLatest { uid -> identity.apply(uid) }
        }
    }
}
