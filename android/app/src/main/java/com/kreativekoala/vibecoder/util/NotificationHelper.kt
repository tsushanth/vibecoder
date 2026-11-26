package com.kreativekoala.vibecoder.util

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.kreativekoala.vibecoder.MainActivity
import com.kreativekoala.vibecoder.R

object NotificationHelper {

    private const val CHANNEL_ID = "generation_complete"
    private const val NOTIFICATION_ID = 1001

    fun createChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.appString(R.string.notif_channel_generation_name),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = context.appString(R.string.notif_channel_generation_desc)
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    fun showGenerationComplete(
        context: Context,
        title: String = context.appString(R.string.notif_generation_ready_title),
        body: String = context.appString(R.string.notif_generation_ready_body),
        projectId: String? = null,
        kind: String = "build_ready"
    ) {
        // A notice is extra: whatever the system does with it, the screen that asked for it carries on.
        runCatching {
            val manager = context.getSystemService(NotificationManager::class.java)
            val open = Intent(context, MainActivity::class.java)
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            open.putExtra(PushOpen.EXTRA_KIND, kind)
            if (projectId != null) open.putExtra(PushOpen.EXTRA_PROJECT_ID, projectId)
            val tap = PendingIntent.getActivity(
                context, projectId?.hashCode() ?: 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build()
            // Tagged with the project like the server's notice (tag + id 0), so one project never shows two.
            if (projectId != null) manager.notify(projectId, 0, notification) else manager.notify(NOTIFICATION_ID, notification)
        }
    }
}
