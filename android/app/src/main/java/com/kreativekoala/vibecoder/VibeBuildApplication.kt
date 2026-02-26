package com.kreativekoala.vibecoder

import android.app.Application
import com.facebook.appevents.AppEventsLogger
import com.kreativekoala.vibecoder.util.NotificationHelper
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class VibeBuildApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannel(this)

        // Initialize Facebook SDK for Meta Ads attribution
        // SDK auto-initializes via manifest metadata; this activates app event logging
        AppEventsLogger.activateApp(this)
    }
}
