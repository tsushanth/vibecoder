package com.kreativekoala.vibecoder.ui.auth

import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.kreativekoala.vibecoder.R
import io.github.jan.supabase.auth.exception.AuthErrorCode
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.auth.exception.AuthWeakPasswordException
import io.github.jan.supabase.exceptions.RestException
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/** Why a sign-in or sign-up attempt failed, as far as the person using the app needs to know. */
enum class AuthFailure {
    WrongCredentials,
    EmailNotConfirmed,
    ConfirmEmailToFinish,
    RateLimited,
    Network,
    WeakPassword,
    InvalidEmail,
    AlreadyRegistered,
    GoogleCancelled,
    GoogleNoAccount,
    GoogleFailed,
    Server,
    Unknown
}

/** A failure to show on the sign-in screen; the screen turns it into text in the app language with [AuthErrors.messageRes]. */
class AuthUiError(val failure: AuthFailure, val signUp: Boolean)

/** Thrown by the repository for a failure it detects itself (not from the network library), carrying only the reason. */
class AuthFailureException(val failure: AuthFailure) : Exception(failure.name)

/**
 * Turns any sign-in/sign-up exception into a short message for the screen. The library's exception text carries the request URL,
 * the request headers (including the Authorization bearer token and the API key) and the HTTP method, so it must never be shown;
 * [logSummary] is the only description of an error that is allowed into the log.
 */
object AuthErrors {

    fun classify(e: Throwable, signUp: Boolean = false): AuthFailure = when (e) {
        is AuthFailureException -> e.failure
        is GetCredentialCancellationException -> AuthFailure.GoogleCancelled
        is NoCredentialException -> AuthFailure.GoogleNoAccount
        is GetCredentialException -> AuthFailure.GoogleFailed
        is AuthWeakPasswordException -> AuthFailure.WeakPassword
        is RestException -> classifyRest(e, signUp)
        is retrofit2.HttpException -> if (e.code() == 429) AuthFailure.RateLimited else AuthFailure.Server
        is IOException -> AuthFailure.Network
        else -> AuthFailure.Unknown
    }

    /** The text for the screen, or null when nothing should be shown (the person cancelled). */
    // English log/test text only: the screen shows messageRes in the app language (literals below are marked i18n-ok).
    fun message(failure: AuthFailure, signUp: Boolean = false): String? = when (failure) {
        AuthFailure.WrongCredentials -> "Wrong email or password" // i18n-ok
        AuthFailure.EmailNotConfirmed -> "Please confirm your email first. Check your inbox for the confirmation link." // i18n-ok
        AuthFailure.ConfirmEmailToFinish -> "Check your email to confirm your account, then sign in." // i18n-ok
        AuthFailure.RateLimited -> "Too many attempts. Please wait a minute and try again." // i18n-ok
        AuthFailure.Network -> "Can't reach the server. Check your internet connection and try again." // i18n-ok
        AuthFailure.WeakPassword -> "That password is too weak. Use at least 6 characters with a mix of letters and numbers." // i18n-ok
        AuthFailure.InvalidEmail -> "Please enter a valid email address." // i18n-ok
        AuthFailure.AlreadyRegistered -> "An account with this email already exists. Try signing in instead." // i18n-ok
        AuthFailure.GoogleCancelled -> null
        AuthFailure.GoogleNoAccount -> "No Google account found on this device. Add one in Settings and try again." // i18n-ok
        AuthFailure.GoogleFailed -> "Google sign-in didn't work. Please try again." // i18n-ok
        AuthFailure.Server -> "Something went wrong on our side. Please try again in a moment." // i18n-ok
        AuthFailure.Unknown -> if (signUp) "Sign up failed. Please try again." else "Sign in failed. Please try again." // i18n-ok
    }

    fun message(e: Throwable, signUp: Boolean = false): String? = message(classify(e, signUp), signUp)

    /** The same text as [message], as a string resource so the screen shows it in the app language; null when nothing should be shown. */
    @androidx.annotation.StringRes
    fun messageRes(failure: AuthFailure, signUp: Boolean = false): Int? = when (failure) {
        AuthFailure.WrongCredentials -> R.string.auth_error_wrong_credentials
        AuthFailure.EmailNotConfirmed -> R.string.auth_error_email_not_confirmed
        AuthFailure.ConfirmEmailToFinish -> R.string.auth_error_confirm_email_to_finish
        AuthFailure.RateLimited -> R.string.auth_error_rate_limited
        AuthFailure.Network -> R.string.auth_error_network
        AuthFailure.WeakPassword -> R.string.auth_error_weak_password
        AuthFailure.InvalidEmail -> R.string.auth_error_invalid_email
        AuthFailure.AlreadyRegistered -> R.string.auth_error_already_registered
        AuthFailure.GoogleCancelled -> null
        AuthFailure.GoogleNoAccount -> R.string.auth_error_google_no_account
        AuthFailure.GoogleFailed -> R.string.auth_error_google_failed
        AuthFailure.Server -> R.string.auth_error_server
        AuthFailure.Unknown -> if (signUp) R.string.auth_error_sign_up_failed else R.string.auth_error_sign_in_failed
    }

    /** What the screen shows for a failure, or null when nothing should be shown (the person cancelled). */
    fun uiError(e: Throwable, signUp: Boolean = false): AuthUiError? {
        val failure = classify(e, signUp)
        return if (messageRes(failure, signUp) == null) null else AuthUiError(failure, signUp)
    }

    /**
     * A log-safe one-line description: the exception class and, for server errors, the status and error code. Never the exception
     * message (it embeds URLs and headers with tokens).
     */
    fun logSummary(e: Throwable): String = buildString {
        append(e.javaClass.simpleName)
        if (e is RestException) {
            append(" status=").append(e.statusCode)
            append(" error=").append(e.error)
            if (e is AuthRestException) append(" code=").append(e.errorCode?.value)
        }
    }

    /** Rethrow cancellation so a cancelled sign-in does not look like a failure. */
    fun rethrowIfCancelled(e: Throwable) {
        if (e is CancellationException) throw e
    }

    private fun classifyRest(e: RestException, signUp: Boolean): AuthFailure {
        val code = (e as? AuthRestException)?.errorCode?.value.orEmpty().lowercase()
        val error = e.error.lowercase()
        val desc = e.description.orEmpty().lowercase()
        val status = e.statusCode
        fun has(vararg words: String) = words.any { it in code || it in error || it in desc }
        return when {
            status == 429 || has("rate_limit", "rate limit", "too many") -> AuthFailure.RateLimited
            has(AuthErrorCode.EmailNotConfirmed.value, "email not confirmed") -> AuthFailure.EmailNotConfirmed
            has(AuthErrorCode.WeakPassword.value, "weak password", "password should be") -> AuthFailure.WeakPassword
            has(AuthErrorCode.UserAlreadyExists.value, AuthErrorCode.EmailExists.value, "already registered", "already exists") ->
                AuthFailure.AlreadyRegistered
            has("email_address_invalid", "invalid email", "unable to validate email") -> AuthFailure.InvalidEmail
            has(AuthErrorCode.InvalidCredentials.value, "invalid_grant", "invalid login credentials") -> AuthFailure.WrongCredentials
            status >= 500 -> AuthFailure.Server
            // GoTrue answers a wrong password with a 400; on the sign-in screen any other 400/401/422 is a credentials problem too.
            !signUp && (status == 400 || status == 401 || status == 422) -> AuthFailure.WrongCredentials
            else -> AuthFailure.Unknown
        }
    }
}
