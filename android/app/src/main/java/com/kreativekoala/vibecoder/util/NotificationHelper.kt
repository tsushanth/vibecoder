package com.kreativekoala.vibecoder.util

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import com.kreativekoala.vibecoder.R

object NotificationHelper {

    private const val CHANNEL_ID = "generation_complete"
    private const val NOTIFICATION_ID = 1001

    fun createChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "App Generation",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Notifies when your app is done generating"
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    fun showGenerationComplete(context: Context, title: String = "Your app is ready!", body: String = "Tap to preview your generated app") {
        val manager = context.getSystemService(NotificationManager::class.java)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }
}
