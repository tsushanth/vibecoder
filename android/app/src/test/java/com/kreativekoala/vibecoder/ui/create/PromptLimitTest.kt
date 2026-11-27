package com.kreativekoala.vibecoder.ui.create

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PromptLimitTest {
    @Test fun theLimitIsTheServers() {
        assertEquals(2000, PromptLimit.MAX_CHARS)
        assertEquals(PromptLimit.Result("a".repeat(2000), cut = false), PromptLimit.apply("", "a".repeat(2000)))
    }

    @Test fun aLongPasteIsCutAndSaidSo() {
        val result = PromptLimit.apply("", "a".repeat(5000))
        assertEquals(2000, result.text.length)
        assertTrue(result.cut)
    }

    @Test fun typingIntoAFullBoxChangesNothing() {
        val full = "a".repeat(1999) + "z"
        val result = PromptLimit.apply(full, full.substring(0, 10) + "X" + full.substring(10))
        assertEquals(full, result.text)
        assertTrue(result.cut)
    }

    @Test fun aPasteInTheMiddleKeepsWhatWasAlreadyThere() {
        val old = "start " + "m".repeat(1980) + " end"
        val pasted = old.substring(0, 6) + "P".repeat(100) + old.substring(6)
        val result = PromptLimit.apply(old, pasted)
        assertEquals(2000, result.text.length)
        assertTrue(result.text.startsWith("start " + "P".repeat(10) + "m"))
        assertTrue(result.text.endsWith("m end"))
    }

    @Test fun anEmojiIsNeverCutInHalf() {
        val result = PromptLimit.apply("a".repeat(1999), "a".repeat(1999) + "😀")
        assertEquals("a".repeat(1999), result.text)
        assertTrue(result.cut)
        assertFalse(PromptLimit.apply("", "😀".repeat(1500)).text.last().isHighSurrogate())
    }

    @Test fun deletingFromAFullBoxIsAllowed() {
        assertEquals(PromptLimit.Result("a".repeat(1990), cut = false), PromptLimit.apply("a".repeat(2000), "a".repeat(1990)))
    }
}
