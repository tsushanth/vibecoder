package com.kreativekoala.vibecoder.ui.telegram

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PromoEventsTest {
    @Test fun everySurfaceMapsToTheStartPayloadItUses() {
        assertEquals(PromoEvents.Surface.BANNER, PromoEvents.surfaceForPayload(TelegramBot.PAYLOAD_BANNER))
        assertEquals(PromoEvents.Surface.CREATE_CARD, PromoEvents.surfaceForPayload(TelegramBot.PAYLOAD_CARD))
        assertEquals(PromoEvents.Surface.POST_BUILD, PromoEvents.surfaceForPayload(TelegramBot.PAYLOAD_BUILD))
        assertEquals(PromoEvents.Surface.ACCOUNT_ROW, PromoEvents.surfaceForPayload(TelegramBot.PAYLOAD_SETTINGS))
        assertNull(PromoEvents.surfaceForPayload("web_home"))
    }

    @Test fun surfaceNamesAreTheOnesTheApiAllows() {
        // backend/lib/appEvents.js PROMO_SURFACES (the in-app ones)
        assertEquals(listOf("banner", "create_card", "post_build", "account_row"), PromoEvents.Surface.values().map { it.wire })
    }

    @Test fun anImpressionIsCountedOncePerSurfaceAndKey() {
        val gate = PromoEvents.ImpressionGate()
        assertTrue(gate.firstTime(PromoEvents.Surface.BANNER))
        assertFalse(gate.firstTime(PromoEvents.Surface.BANNER))
        assertTrue(gate.firstTime(PromoEvents.Surface.CREATE_CARD))
        assertTrue(gate.firstTime(PromoEvents.Surface.POST_BUILD, "project-1"))
        assertFalse(gate.firstTime(PromoEvents.Surface.POST_BUILD, "project-1"))
        assertTrue("a second build is a new impression", gate.firstTime(PromoEvents.Surface.POST_BUILD, "project-2"))
    }

    @Test fun callsBeforeInitDoNothingAndNeverThrow() {
        PromoEvents.impression(PromoEvents.Surface.ACCOUNT_ROW)
        PromoEvents.tap(PromoEvents.Surface.ACCOUNT_ROW)
        PromoEvents.dismiss(PromoEvents.Surface.BANNER)
    }
}
