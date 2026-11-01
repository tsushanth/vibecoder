package com.kreativekoala.vibecoder.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SseHttpErrorsTest {
    @Test fun rateLimitShowsTheServersMessagePlainly() {
        assertEquals(
            "You've reached today's fair-use limit. Try again tomorrow.",
            SseHttpErrors.message(429, """{"error":"You've reached today's fair-use limit. Try again tomorrow."}""")
        )
        assertEquals("Slow down a little.", SseHttpErrors.message(429, """{"success":false,"message":"Slow down a little."}"""))
    }

    @Test fun rateLimitWithoutAJsonMessageUsesAPlainFallback() {
        for (body in listOf("", "<html>Too Many Requests</html>", "{}", """{"error":""}""", """{"error":{"code":1}}""")) {
            val m = SseHttpErrors.message(429, body)
            assertEquals(SseHttpErrors.RATE_LIMIT_FALLBACK, m)
            assertFalse(m.contains("429"))
            assertFalse(m.contains("<"))
        }
    }

    @Test fun otherStatusesKeepTheirForm() {
        assertEquals("HTTP 500: boom", SseHttpErrors.message(500, """{"error":"boom"}"""))
        assertEquals("HTTP 502: bad gateway", SseHttpErrors.message(502, "bad gateway"))
    }
}
