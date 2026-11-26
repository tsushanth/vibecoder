package com.kreativekoala.vibecoder.service

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Sends this device's push token to the server, trying again when that fails. A single attempt that failed used to mean no
 * notifications until the next app start, with nothing to show for it.
 */
class PushTokenUploader(
    private val send: suspend (userId: String, token: String) -> Unit,
    private val retryDelaysMs: List<Long> = listOf(2_000L, 10_000L, 60_000L)
) {
    /** True once the server took it. Cancelling (sign-out, another account) drops the pending retries. */
    suspend fun upload(userId: String, token: String): Boolean {
        for (attempt in 0..retryDelaysMs.size) {
            try {
                send(userId, token)
                return true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (attempt < retryDelaysMs.size) delay(retryDelaysMs[attempt])
            }
        }
        return false
    }
}
