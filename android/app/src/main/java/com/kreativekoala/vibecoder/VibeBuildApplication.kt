package com.kreativekoala.vibecoder

import android.app.Application
import android.util.Log
import com.kreativekoala.vibecoder.util.Constants
import com.kreativekoala.vibecoder.util.NotificationHelper
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class VibeBuildApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannel(this)
        initRevenueCat()
    }

    private fun initRevenueCat() {
        Purchases.logLevel = if (BuildConfig.DEBUG) LogLevel.DEBUG else LogLevel.ERROR

        val config = PurchasesConfiguration.Builder(this, Constants.REVENUECAT_API_KEY)
            .build()
        Purchases.configure(config)

        Log.d("VibeBuildApplication", "RevenueCat initialized")
    }
}
