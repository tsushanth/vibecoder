package com.kreativekoala.vibecoder.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

class AppLanguageTest {
    private val shipped = listOf("ar", "cs", "de", "el", "es", "fi", "fr", "hi", "hu", "in", "it", "ja", "ko", "ms", "nl", "pl", "pt-BR", "ro", "ru", "sv", "th", "tl", "tr", "uk", "vi", "zh-CN", "zh-TW", "zh-HK")

    @Test fun everyShippedLanguageMapsToItsApiTag() {
        val expected = mapOf("in" to "id", "pt-BR" to "pt", "zh-CN" to "zh", "zh-TW" to "zh-TW", "zh-HK" to "zh-HK")
        for (tag in shipped) {
            val locale = Locale.forLanguageTag(tag)
            assertEquals(tag, expected[tag] ?: tag, AppLanguage.tagFor(locale))
        }
    }

    @Test fun androidLegacyIndonesianCodeAndFilipinoAreMapped() {
        assertEquals("id", AppLanguage.tagFor(Locale("in", "ID")))
        assertEquals("id", AppLanguage.tagFor(Locale.forLanguageTag("id-ID")))
        assertEquals("tl", AppLanguage.tagFor(Locale.forLanguageTag("fil-PH")))
    }

    @Test fun regionsTheAppDoesNotShipShowEnglish() {
        assertNull(AppLanguage.tagFor(Locale.forLanguageTag("pt-PT")))
        assertNull(AppLanguage.tagFor(Locale.forLanguageTag("zh-MY")))
        assertEquals("zh", AppLanguage.tagFor(Locale.forLanguageTag("zh-Hans")))
        assertEquals("pt", AppLanguage.tagFor(Locale.forLanguageTag("pt")))
        assertEquals("es", AppLanguage.tagFor(Locale.forLanguageTag("es-MX")))
    }

    @Test fun chineseVariantsAreDistinct() {
        for (t in listOf("zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN", "zh-Hans-SG")) assertEquals(t, "zh", AppLanguage.tagFor(Locale.forLanguageTag(t)))
        for (t in listOf("zh-TW", "zh-Hant", "zh-Hant-TW", "zh-MO", "zh-Hant-MO")) assertEquals(t, "zh-TW", AppLanguage.tagFor(Locale.forLanguageTag(t)))
        for (t in listOf("zh-HK", "zh-Hant-HK")) assertEquals(t, "zh-HK", AppLanguage.tagFor(Locale.forLanguageTag(t)))
        assertEquals("zh-TW", AppLanguage.forLocales(listOf(Locale.forLanguageTag("zh-Hant-TW"), Locale.GERMANY)))
    }

    @Test fun englishAndUnknownLanguagesAreEnglish() {
        assertEquals("en", AppLanguage.forLocales(listOf(Locale.US)))
        assertEquals("en", AppLanguage.forLocales(listOf(Locale.forLanguageTag("sw-KE"))))
        assertEquals("en", AppLanguage.forLocales(emptyList()))
    }

    @Test fun firstTranslatedLocaleInTheListWins() {
        assertEquals("de", AppLanguage.forLocales(listOf(Locale.forLanguageTag("sw-KE"), Locale.GERMANY, Locale.FRANCE)))
        assertEquals("en", AppLanguage.forLocales(listOf(Locale.US, Locale.GERMANY)))
    }
}
