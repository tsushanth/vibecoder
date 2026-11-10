package com.kreativekoala.vibecoder.data.repository

import com.kreativekoala.vibecoder.data.model.UpdateListingRequest
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import kotlinx.coroutines.CancellationException
import javax.inject.Inject
import javax.inject.Singleton

/** Seam so the screen's state holder can be unit-tested with a fake. */
interface ExploreListingApi {
    /** Whether the project is listed on Explore right now, or null when it could not be read. */
    suspend fun isListed(projectId: String): Boolean?

    /** Saves the choice. True when the server accepted it. */
    suspend fun setListed(projectId: String, listed: Boolean): Boolean
}

@Singleton
class ExploreListingRepository @Inject constructor(
    private val api: VibeBuildApi,
    private val authRepository: AuthRepository
) : ExploreListingApi {

    override suspend fun isListed(projectId: String): Boolean? = try {
        api.getProject(projectId).project?.isPublic
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    override suspend fun setListed(projectId: String, listed: Boolean): Boolean {
        val userId = authRepository.currentUser?.uid ?: return false
        return try {
            api.setListing(projectId, UpdateListingRequest(userId = userId, isPublic = listed)).success
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        }
    }
}
