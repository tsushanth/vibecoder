package com.kreativekoala.vibecoder.util

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.annotation.StringRes
import androidx.appcompat.app.AppCompatDelegate

/**
 * A string resource in the language the person picked in the app (Account > Language), for text built outside a composable
 * (view models, notifications). Before Android 13 the application context does not follow the in-app language, only activities
 * do, so this applies the app's locales itself; with no in-app choice it is the plain [Context.getString].
 */
fun Context.appString(@StringRes id: Int, vararg args: Any): String {
    val localized = runCatching {
        val chosen = AppCompatDelegate.getApplicationLocales()
        if (chosen.isEmpty) this
        else createConfigurationContext(
            Configuration(resources.configuration).apply { setLocales(LocaleList.forLanguageTags(chosen.toLanguageTags())) }
        )
    }.getOrDefault(this)
    return if (args.isEmpty()) localized.getString(id) else localized.getString(id, *args)
}
