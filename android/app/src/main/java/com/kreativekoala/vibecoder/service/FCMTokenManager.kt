package com.kreativekoala.vibecoder.service

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging
import com.kreativekoala.vibecoder.data.local.UserPreferences
import com.kreativekoala.vibecoder.data.model.PushTokenRequest
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FCMTokenManager @Inject constructor(
    private val api: VibeBuildApi,
    private val userPreferences: UserPreferences,
    private val authRepository: AuthRepository,
    @ApplicationContext private val context: Context
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var upload: Job? = null

    private val uploader = PushTokenUploader(send = { userId, token ->
        api.registerPushToken(
            PushTokenRequest(
                userId = userId,
                token = token,
                notificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
            )
        )
    })

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

    /** Sends the token again for whoever is signed in, for example right after notifications were allowed. */
    fun refresh() {
        authRepository.currentUser?.uid?.let(::registerTokenForUser)
    }

    fun onTokenRefreshed(token: String) {
        scope.launch {
            val userId = authRepository.currentUser?.uid ?: userPreferences.userId.firstOrNull() ?: return@launch
            uploadToken(userId, token)
        }
    }

    @Synchronized
    private fun uploadToken(userId: String, token: String) {
        upload?.cancel() // the newest user and token win
        upload = scope.launch {
            if (!uploader.upload(userId, token)) Log.w("FCM", "Push token was not stored; trying again at the next start")
        }
    }
}
