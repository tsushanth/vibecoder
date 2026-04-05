package com.kreativekoala.vibecoder.service

import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.kreativekoala.vibecoder.data.local.UserPreferences
import com.kreativekoala.vibecoder.data.model.PushTokenRequest
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FCMTokenManager @Inject constructor(
    private val api: VibeBuildApi,
    private val userPreferences: UserPreferences
) {
    private val scope = CoroutineScope(Dispatchers.IO)

    fun registerTokenForUser(userId: String) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.w("FCM", "Failed to get FCM token", task.exception)
                return@addOnCompleteListener
            }
            val token = task.result ?: return@addOnCompleteListener
            uploadToken(userId, token)
        }
    }

    fun onTokenRefreshed(token: String) {
        scope.launch {
            val userId = userPreferences.userId.firstOrNull() ?: return@launch
            uploadToken(userId, token)
        }
    }

    private fun uploadToken(userId: String, token: String) {
        scope.launch {
            try {
                api.registerPushToken(PushTokenRequest(userId = userId, token = token))
                Log.d("FCM", "Push token registered for user $userId")
            } catch (e: Exception) {
                Log.w("FCM", "Failed to register push token: ${e.message}")
            }
        }
    }
}
