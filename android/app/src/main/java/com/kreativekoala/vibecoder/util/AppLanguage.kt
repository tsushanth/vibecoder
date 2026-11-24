package com.kreativekoala.vibecoder.util

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import java.util.Locale

/**
 * The language the app is showing, as the short tag the API understands (for the Create-screen idea suggestions).
 * One of the shipped UI languages, or "en". zh-rCN (Simplified) is sent as "zh", Traditional Chinese as "zh-TW" (Taiwan, and the
 * Hant script fallback incl. Macau) or "zh-HK" (Hong Kong), pt-rBR as "pt" and Android's legacy "in" as "id". Old API clients only
 * ever send "zh", which stays Simplified.
 */
object AppLanguage {
    private val SUPPORTED = setOf(
        "ar", "cs", "de", "el", "es", "fi", "fr", "hi", "hu", "id", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tl", "tr", "uk", "vi", "zh",
    )

    /** The API tag for one locale, or null when the app has no translation for it (so the next locale in the list applies). */
    fun tagFor(locale: Locale): String? {
        val lang = when (val l = locale.language.lowercase()) {
            "in" -> "id"
            "fil" -> "tl"
            else -> l
        }
        if (lang == "en") return "en" // English is the default resources, so it ends the search like any translated language
        if (lang !in SUPPORTED) return null
        val country = locale.country.uppercase()
        return when (lang) {
            // The app ships Brazilian Portuguese and Simplified Chinese only; other regions show English.
            "pt" -> if (country.isEmpty() || country == "BR") "pt" else null
            "zh" -> chineseTag(locale.script, country)
            else -> lang
        }
    }

    /** Simplified ("zh") for no region, CN, SG or the Hans script; Traditional ("zh-TW" / "zh-HK") for TW, HK, MO or the Hant script; other regions are not shipped. */
    private fun chineseTag(script: String, country: String): String? = when {
        script.equals("Hans", ignoreCase = true) -> "zh"
        country == "HK" -> "zh-HK" // i18n-ok: wire value
        script.equals("Hant", ignoreCase = true) || country == "TW" || country == "MO" -> "zh-TW" // i18n-ok: wire value
        country.isEmpty() || country == "CN" || country == "SG" -> "zh"
        else -> null
    }

    /** The first locale in [locales] the app is translated into, mirroring how Android picks resources; "en" when none is. */
    fun forLocales(locales: List<Locale>): String = locales.firstNotNullOfOrNull { tagFor(it) } ?: "en"

    /** The language the app is showing now: the per-app language if one is set, else the system language list. */
    fun current(): String = try {
        val list = AppCompatDelegate.getApplicationLocales().takeIf { !it.isEmpty } ?: LocaleListCompat.getAdjustedDefault()
        forLocales((0 until list.size()).mapNotNull { list.get(it) })
    } catch (e: Exception) {
        "en" // a language lookup must never break a screen
    }
}
