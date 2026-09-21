package com.kreativekoala.vibecoder.data.repository

import com.google.gson.Gson
import com.kreativekoala.vibecoder.data.model.AddDomainRequest
import com.kreativekoala.vibecoder.data.model.AddDomainResponse
import com.kreativekoala.vibecoder.data.model.DomainInfoResponse
import com.kreativekoala.vibecoder.data.model.VerifyDomainRequest
import com.kreativekoala.vibecoder.data.model.VerifyDomainResponse
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import kotlinx.coroutines.CancellationException
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** Failure taxonomy the UI state machine understands; keeps HTTP details out of the ViewModel. */
sealed class DomainFailure {
    data object UpgradeRequired : DomainFailure()            // 403 upgrade:true (free tier)
    data class InvalidDomain(val message: String) : DomainFailure()   // 400
    data object AlreadyRegistered : DomainFailure()          // 409
    data object Network : DomainFailure()
    data class Other(val message: String) : DomainFailure()
}

sealed class DomainResult<out T> {
    data class Ok<T>(val value: T) : DomainResult<T>()
    data class Failed(val failure: DomainFailure) : DomainResult<Nothing>()
}

/** Seam so the state machine can be unit-tested with a fake. */
interface DomainApi {
    suspend fun add(deploymentId: String, userId: String, domain: String): DomainResult<AddDomainResponse>
    suspend fun verify(deploymentId: String, userId: String): DomainResult<VerifyDomainResponse>
    suspend fun get(deploymentId: String, userId: String): DomainResult<DomainInfoResponse>
    suspend fun remove(deploymentId: String, userId: String): DomainResult<Boolean>
}

@Singleton
class DomainRepository @Inject constructor(
    private val api: VibeBuildApi
) : DomainApi {

    override suspend fun add(deploymentId: String, userId: String, domain: String) =
        call { api.addDomain(deploymentId, AddDomainRequest(userId, domain)) }

    override suspend fun verify(deploymentId: String, userId: String) =
        call { api.verifyDomain(deploymentId, VerifyDomainRequest(userId)) }

    override suspend fun get(deploymentId: String, userId: String) =
        call { api.getDomain(deploymentId, userId) }

    override suspend fun remove(deploymentId: String, userId: String) =
        call { api.removeDomain(deploymentId, VerifyDomainRequest(userId)).removed }

    private suspend fun <T> call(block: suspend () -> T): DomainResult<T> = try {
        DomainResult.Ok(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: HttpException) {
        DomainResult.Failed(mapHttp(e.code(), runCatching { e.response()?.errorBody()?.string() }.getOrNull()))
    } catch (e: IOException) {
        DomainResult.Failed(DomainFailure.Network)
    } catch (e: Exception) {
        DomainResult.Failed(DomainFailure.Other(e.message ?: "Something went wrong"))
    }

    companion object {
        private data class ErrBody(val error: String? = null, val upgrade: Boolean? = null)

        fun mapHttp(code: Int, body: String?): DomainFailure {
            val err = runCatching { Gson().fromJson(body, ErrBody::class.java) }.getOrNull()
            val msg = err?.error
            return when {
                code == 403 && err?.upgrade == true -> DomainFailure.UpgradeRequired
                code == 409 -> DomainFailure.AlreadyRegistered
                code == 400 -> DomainFailure.InvalidDomain(msg ?: "That doesn't look like a valid domain.")
                else -> DomainFailure.Other(msg ?: "Request failed ($code)")
            }
        }
    }
}
