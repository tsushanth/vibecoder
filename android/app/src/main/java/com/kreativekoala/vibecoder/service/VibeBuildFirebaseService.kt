package com.kreativekoala.vibecoder.service

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.kreativekoala.vibecoder.util.NotificationHelper
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class VibeBuildFirebaseService : FirebaseMessagingService() {

    @Inject
    lateinit var fcmTokenManager: FCMTokenManager

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d("FCM", "New token: ${token.take(8)}...")
        fcmTokenManager.onTokenRefreshed(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.notification?.title ?: return
        val body = message.notification?.body ?: return
        Log.d("FCM", "Message received: $title")
        NotificationHelper.showGenerationComplete(applicationContext, title, body)
    }
}
