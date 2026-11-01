package com.kreativekoala.vibecoder.ui.auth

import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import io.github.jan.supabase.auth.exception.AuthErrorCode
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.auth.exception.AuthWeakPasswordException
import io.github.jan.supabase.exceptions.HttpRequestException
import io.github.jan.supabase.exceptions.RestException
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.coroutines.cancellation.CancellationException

class AuthErrorsTest {
    // The shape of the leak seen on the device: URL, bearer token, api key and method inside the exception text.
    private val leaky = "Bad Request: Invalid login credentials\n" +
        "URL: https://owvvrljdfnhntwedepkl.supabase.co/auth/v1/token?grant_type=password\n" +
        "Headers: [Authorization=[Bearer eyJhbGciOiJIUzI1NiJ9.SECRET], apikey=[eyJhbGciOiJIUzI1NiJ9.SECRET]]\n" +
        "Http Method: POST"

    private fun rest(status: Int, error: String = "", desc: String = "", code: AuthErrorCode? = null): RestException {
        val e = mockk<AuthRestException>(relaxed = true)
        every { e.statusCode } returns status
        every { e.error } returns error
        every { e.description } returns desc
        every { e.message } returns leaky
        every { e.errorCode } returns (code ?: AuthErrorCode.UnexpectedFailure)
        return e
    }

    private fun assertSafe(text: String?) {
        if (text == null) return
        for (bad in listOf("http", "Bearer", "eyJ", "apikey", "Authorization", "Headers", "Http Method", "supabase.co", "POST", "Exception")) {
            assertFalse("leaked '$bad' in: $text", text.contains(bad, ignoreCase = true))
        }
    }

    @Test fun wrongPassword_isAShortHumanMessage() {
        val e = rest(400, "invalid_credentials", "Invalid login credentials", AuthErrorCode.InvalidCredentials)
        assertEquals(AuthFailure.WrongCredentials, AuthErrors.classify(e))
        assertEquals("Wrong email or password", AuthErrors.message(e))
        assertSafe(AuthErrors.message(e))
    }

    @Test fun oldGoTrueInvalidGrant_isWrongPassword() {
        assertEquals("Wrong email or password", AuthErrors.message(rest(400, "invalid_grant", "Invalid login credentials")))
    }

    @Test fun unknown400OnSignIn_isStillWrongPassword_butNotOnSignUp() {
        assertEquals(AuthFailure.WrongCredentials, AuthErrors.classify(rest(400, "bad_request", "x")))
        assertEquals(AuthFailure.Unknown, AuthErrors.classify(rest(400, "bad_request", "x"), signUp = true))
    }

    @Test fun unconfirmedEmail() {
        val e = rest(400, "email_not_confirmed", "Email not confirmed", AuthErrorCode.EmailNotConfirmed)
        assertEquals(AuthFailure.EmailNotConfirmed, AuthErrors.classify(e))
        assertTrue(AuthErrors.message(e)!!.contains("confirm"))
        assertSafe(AuthErrors.message(e))
    }

    @Test fun rateLimits() {
        assertEquals(AuthFailure.RateLimited, AuthErrors.classify(rest(429, "over_request_rate_limit", "Too many requests")))
        assertEquals(AuthFailure.RateLimited, AuthErrors.classify(rest(429)))
        assertEquals(AuthFailure.RateLimited, AuthErrors.classify(rest(400, "over_email_send_rate_limit", "x"), signUp = true))
        assertEquals(AuthFailure.RateLimited, AuthErrors.classify(retrofit2.HttpException(retrofit2.Response.error<Any>(429, okhttp3.ResponseBody.create(null, "")))))
        assertSafe(AuthErrors.message(AuthFailure.RateLimited))
    }

    @Test fun networkErrors() {
        assertEquals(AuthFailure.Network, AuthErrors.classify(UnknownHostException("owvvrljdfnhntwedepkl.supabase.co")))
        assertEquals(AuthFailure.Network, AuthErrors.classify(SocketTimeoutException("timeout")))
        assertEquals(AuthFailure.Network, AuthErrors.classify(IOException("boom")))
        val http = mockk<HttpRequestException>(relaxed = true)
        every { http.message } returns leaky
        assertEquals(AuthFailure.Network, AuthErrors.classify(http))
        assertSafe(AuthErrors.message(UnknownHostException("owvvrljdfnhntwedepkl.supabase.co")))
    }

    @Test fun signUpFailures() {
        val dup = rest(422, "user_already_exists", "User already registered", AuthErrorCode.UserAlreadyExists)
        assertEquals(AuthFailure.AlreadyRegistered, AuthErrors.classify(dup, signUp = true))
        val weak = mockk<AuthWeakPasswordException>(relaxed = true)
        every { weak.message } returns leaky
        assertEquals(AuthFailure.WeakPassword, AuthErrors.classify(weak, signUp = true))
        assertEquals(AuthFailure.InvalidEmail, AuthErrors.classify(rest(400, "email_address_invalid", "x"), signUp = true))
        assertEquals(AuthFailure.ConfirmEmailToFinish, AuthErrors.classify(AuthFailureException(AuthFailure.ConfirmEmailToFinish), signUp = true))
        for (f in AuthFailure.entries) assertSafe(AuthErrors.message(f, signUp = true))
    }

    @Test fun serverErrors() {
        assertEquals(AuthFailure.Server, AuthErrors.classify(rest(500, "unexpected_failure", "x")))
        assertEquals(AuthFailure.Server, AuthErrors.classify(rest(503)))
        assertEquals(AuthFailure.Server, AuthErrors.classify(retrofit2.HttpException(retrofit2.Response.error<Any>(500, okhttp3.ResponseBody.create(null, "")))))
    }

    @Test fun googleSignInPaths() {
        assertEquals(AuthFailure.GoogleCancelled, AuthErrors.classify(GetCredentialCancellationException("user cancelled")))
        assertNull(AuthErrors.message(GetCredentialCancellationException("user cancelled")))
        assertEquals(AuthFailure.GoogleNoAccount, AuthErrors.classify(NoCredentialException("none")))
        assertEquals(AuthFailure.GoogleFailed, AuthErrors.classify(AuthFailureException(AuthFailure.GoogleFailed)))
    }

    @Test fun anythingElse_isGenericAndNeverTheExceptionText() {
        val e = IllegalStateException(leaky)
        assertEquals(AuthFailure.Unknown, AuthErrors.classify(e))
        assertEquals("Sign in failed. Please try again.", AuthErrors.message(e))
        assertEquals("Sign up failed. Please try again.", AuthErrors.message(e, signUp = true))
        assertSafe(AuthErrors.message(e))
    }

    @Test fun logSummaryNeverContainsTheExceptionMessage() {
        val rest = rest(400, "invalid_credentials", "Invalid login credentials", AuthErrorCode.InvalidCredentials)
        for (e in listOf(rest, IllegalStateException(leaky), IOException(leaky))) {
            val line = AuthErrors.logSummary(e)
            assertFalse(line, line.contains("Bearer"))
            assertFalse(line, line.contains("eyJ"))
            assertFalse(line, line.contains("Headers"))
            assertFalse(line, line.contains("https://"))
        }
        assertTrue(AuthErrors.logSummary(rest).contains("status=400"))
    }

    @Test fun cancellationIsRethrown() {
        try {
            AuthErrors.rethrowIfCancelled(CancellationException("scope cancelled"))
            fail("expected CancellationException")
        } catch (_: CancellationException) {
        }
        AuthErrors.rethrowIfCancelled(IOException("not a cancellation"))
    }
}
