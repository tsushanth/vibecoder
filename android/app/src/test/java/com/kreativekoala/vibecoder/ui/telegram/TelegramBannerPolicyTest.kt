package com.kreativekoala.vibecoder.ui.telegram

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TelegramBannerPolicyTest {
    private val day = 24L * 60 * 60 * 1000
    private val now = 1_800_000_000_000L

    @Test fun neverDismissedShows() {
        assertTrue(TelegramBannerPolicy.shouldShow(now, 0L, opened = false))
    }

    @Test fun dismissedHidesForTheWholeWindowThenComesBack() {
        val dismissed = now
        assertFalse(TelegramBannerPolicy.shouldShow(now + 1, dismissed, opened = false))
        assertFalse(TelegramBannerPolicy.shouldShow(now + 6 * day, dismissed, opened = false))
        assertTrue(TelegramBannerPolicy.shouldShow(now + TelegramBannerPolicy.RESHOW_AFTER_DAYS * day, dismissed, opened = false))
        assertTrue(TelegramBannerPolicy.shouldShow(now + 30 * day, dismissed, opened = false))
    }

    @Test fun openingTheBotHidesItForGood() {
        assertFalse(TelegramBannerPolicy.shouldShow(now, 0L, opened = true))
        assertFalse(TelegramBannerPolicy.shouldShow(now + 365 * day, now, opened = true))
    }

    @Test fun legacyDismissIsCountedFromTheFirstRunOfThisVersion() {
        assertEquals(now, TelegramBannerPolicy.effectiveDismissedAt(legacyDismissed = true, storedDismissedAt = 0L, nowMs = now))
        assertEquals(123L, TelegramBannerPolicy.effectiveDismissedAt(legacyDismissed = true, storedDismissedAt = 123L, nowMs = now))
        assertEquals(0L, TelegramBannerPolicy.effectiveDismissedAt(legacyDismissed = false, storedDismissedAt = 0L, nowMs = now))
        assertFalse(TelegramBannerPolicy.shouldShow(now + day, TelegramBannerPolicy.effectiveDismissedAt(true, 0L, now), opened = false))
    }

    @Test fun deepLinksCarryTheStartPayload() {
        assertEquals("https://t.me/Vibebuilder_bot?start=app", TelegramBot.url(TelegramBot.PAYLOAD_BANNER))
        assertEquals("https://t.me/Vibebuilder_bot?start=app_build", TelegramBot.url(TelegramBot.PAYLOAD_BUILD))
        for (p in listOf(TelegramBot.PAYLOAD_BANNER, TelegramBot.PAYLOAD_CARD, TelegramBot.PAYLOAD_BUILD, TelegramBot.PAYLOAD_SETTINGS)) {
            assertTrue("payload $p must be valid for Telegram", Regex("^[A-Za-z0-9_-]{1,64}$").matches(p))
        }
    }
}
