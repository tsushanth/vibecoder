package com.kreativekoala.vibecoder

import android.app.Application
import com.kreativekoala.vibecoder.util.NotificationHelper
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class VibeBuildApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannel(this)
    }
}
