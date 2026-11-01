package com.kreativekoala.vibecoder.ui.create

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BuildTimerTest {
    private val now = 1_793_564_895_000L // the wall-clock time that showed up as "29892748:15"

    @Test fun unsetStartIsHidden_notNowMinusZero() {
        assertNull(BuildTimer.elapsedSeconds(0L, now))
        assertNull(BuildTimer.label(0L, now))
    }

    @Test fun negativeStartAndNegativeSpanAreHidden() {
        assertNull(BuildTimer.label(-5L, now))
        assertNull(BuildTimer.label(now, now - 1_000)) // end before start
        assertNull(BuildTimer.elapsedSeconds(now, 0L))
    }

    @Test fun hugeSpanIsHidden() {
        assertNull(BuildTimer.label(1L, now))
        assertNull(BuildTimer.label(now - 25 * 3600 * 1000L, now))
        assertNull(BuildTimer.format(Long.MAX_VALUE))
        assertNull(BuildTimer.format(-1))
        assertNull(BuildTimer.format(null))
    }

    @Test fun normalSpansFormat() {
        assertEquals("0:00", BuildTimer.label(now, now))
        assertEquals("0:09", BuildTimer.label(now - 9_000, now))
        assertEquals("1:35", BuildTimer.label(now - 95_000, now))
        assertEquals("12:00", BuildTimer.label(now - 720_000, now))
        assertEquals("1:00:00", BuildTimer.label(now - 3_600_000, now))
        assertEquals("23:59:59", BuildTimer.format(BuildTimer.MAX_PLAUSIBLE_SECONDS - 1))
    }
}
