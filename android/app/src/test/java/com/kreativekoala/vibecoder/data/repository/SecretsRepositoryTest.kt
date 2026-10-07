package com.kreativekoala.vibecoder.data.repository

import com.kreativekoala.vibecoder.data.model.SecretValueRequest
import org.junit.Assert.*
import org.junit.Test

class SecretsRepositoryTest {
    private fun map(code: Int, body: String? = null) = SecretsRepository.mapHttp(code, body)

    @Test fun statusCodesMapToWhatTheScreenNeeds() {
        assertEquals(SecretsFailure.Unauthorized, map(401))
        assertEquals(SecretsFailure.Forbidden, map(403))
        assertEquals(SecretsFailure.Unavailable, map(404))
        assertEquals(SecretsFailure.Unavailable, map(503))
        assertEquals(SecretsFailure.RateLimited, map(429))
        assertEquals(SecretsFailure.StoreDown, map(502))
        assertEquals(SecretsFailure.InvalidValue, map(400))
        assertEquals(SecretsFailure.InvalidValue, map(413))
    }

    @Test fun otherErrorsCarryOnlyAShortServerCode() {
        assertEquals(SecretsFailure.Other("bad_json"), map(422, """{"error":"bad_json"}"""))
        assertEquals(SecretsFailure.Other("http_500"), map(500, "<html>oops</html>"))
        assertEquals(SecretsFailure.Other("http_500"), map(500, """{"error":"Something with spaces, or a pasted key sk-abc"}"""))
        assertEquals(SecretsFailure.Other("http_500"), map(500, null))
    }

    @Test fun aRequestBodyNeverPrintsItsValue() {
        assertFalse(SecretValueRequest("sk-live-123").toString().contains("sk-live-123"))
    }
}
