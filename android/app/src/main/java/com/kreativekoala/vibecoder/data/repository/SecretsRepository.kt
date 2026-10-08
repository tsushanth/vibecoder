package com.kreativekoala.vibecoder.data.repository

import com.google.gson.Gson
import com.kreativekoala.vibecoder.data.model.SecretValueRequest
import com.kreativekoala.vibecoder.data.model.SecretsResponse
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import kotlinx.coroutines.CancellationException
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** What can go wrong with a key call, in the terms the screen needs. Never carries a key value. */
sealed class SecretsFailure {
    data object Unauthorized : SecretsFailure()      // 401: sign in again
    data object Forbidden : SecretsFailure()         // 403: not the creator
    data object Unavailable : SecretsFailure()       // 404 or 503: this app has no key support, hide the section
    data object RateLimited : SecretsFailure()       // 429
    data object StoreDown : SecretsFailure()         // 502: the key store is unavailable, retry later
    data object InvalidValue : SecretsFailure()      // 400 or 413
    data object Network : SecretsFailure()
    data class Other(val code: String) : SecretsFailure()   // a short server code or "http_NNN", never free text
}

sealed class SecretsResult<out T> {
    data class Ok<T>(val value: T) : SecretsResult<T>()
    data class Failed(val failure: SecretsFailure) : SecretsResult<Nothing>()
}

/** Seam so the state machine can be unit-tested with a fake. */
interface SecretsApi {
    suspend fun list(projectId: String): SecretsResult<SecretsResponse>
    suspend fun set(projectId: String, name: String, value: String): SecretsResult<Unit>
    suspend fun remove(projectId: String, name: String): SecretsResult<Unit>
}

@Singleton
class SecretsRepository @Inject constructor(
    private val api: VibeBuildApi
) : SecretsApi {

    override suspend fun list(projectId: String) = call { api.getSecrets(projectId) }

    override suspend fun set(projectId: String, name: String, value: String) =
        call { api.setSecret(projectId, name, SecretValueRequest(value)) }

    override suspend fun remove(projectId: String, name: String) = call { api.deleteSecret(projectId, name) }

    private suspend fun <T> call(block: suspend () -> T): SecretsResult<T> = try {
        SecretsResult.Ok(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: HttpException) {
        SecretsResult.Failed(mapHttp(e.code(), runCatching { e.response()?.errorBody()?.string() }.getOrNull()))
    } catch (e: IOException) {
        SecretsResult.Failed(SecretsFailure.Network)
    } catch (e: Exception) {
        SecretsResult.Failed(SecretsFailure.Other("error"))
    }

    companion object {
        private data class ErrBody(val error: String? = null)
        private val SAFE_CODE = Regex("^[a-z_]{1,40}$")

        fun mapHttp(code: Int, body: String?): SecretsFailure = when (code) {
            401 -> SecretsFailure.Unauthorized
            403 -> SecretsFailure.Forbidden
            404, 503 -> SecretsFailure.Unavailable
            429 -> SecretsFailure.RateLimited
            502 -> SecretsFailure.StoreDown
            400, 413 -> SecretsFailure.InvalidValue
            else -> {
                val err = runCatching { Gson().fromJson(body, ErrBody::class.java) }.getOrNull()?.error
                SecretsFailure.Other(if (err != null && SAFE_CODE.matches(err)) err else "http_$code")
            }
        }
    }
}
