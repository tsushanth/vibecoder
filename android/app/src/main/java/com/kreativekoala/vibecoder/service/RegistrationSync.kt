package com.kreativekoala.vibecoder.service

import com.kreativekoala.vibecoder.data.repository.AuthUser
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChangedBy

/**
 * Makes sure the signed-in person has their account on the server; without it the server refused every build.
 *
 * [run] is fed the session from the application scope, so it registers on each sign-in and on each launch with a stored session.
 * Registration used to run only inside the sign-in screen's ViewModel, which is torn down as soon as the session appears: that
 * cancelled the request, and nothing ever tried again.
 */
class RegistrationSync(
    private val register: suspend (AuthUser) -> Unit,
    private val onRegistered: (userId: String) -> Unit,
    private val onGaveUp: (Exception) -> Unit,
    private val retryDelaysMs: List<Long> = listOf(2_000L, 8_000L, 30_000L, 120_000L)
) {
    /** Collects until cancelled. Signing out, or switching account, drops the retries still pending for the previous one. */
    suspend fun run(sessions: Flow<AuthUser?>) {
        sessions.distinctUntilChangedBy { it?.uid }.collectLatest { apply(it) }
    }

    private suspend fun apply(user: AuthUser?) {
        if (user == null) return
        for (attempt in 0..retryDelaysMs.size) {
            try {
                register(user)
                onRegistered(user.uid)
                return
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (attempt < retryDelaysMs.size) delay(retryDelaysMs[attempt]) else onGaveUp(e)
            }
        }
    }
}
