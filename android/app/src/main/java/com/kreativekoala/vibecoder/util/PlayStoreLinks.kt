package com.kreativekoala.vibecoder.util

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Opens this app's Play listing (for the Settings "Rate VibeBuild" row). Independent of the in-app review flow. */
object PlayStoreLinks {
    fun marketUrl(packageName: String) = "market://details?id=$packageName"
    fun webUrl(packageName: String) = "https://play.google.com/store/apps/details?id=$packageName"

    /** Tries the Play Store app first, falls back to the web listing. Returns false if neither could be opened. */
    fun openListing(context: Context): Boolean {
        val pkg = context.packageName
        for (url in listOf(marketUrl(pkg), webUrl(pkg))) {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return true
            } catch (_: ActivityNotFoundException) {
                // no handler for this scheme: try the next one
            }
        }
        return false
    }
}
