package com.kreativekoala.vibecoder.data.repository

import com.kreativekoala.vibecoder.data.model.AdsToggleRequest
import com.kreativekoala.vibecoder.data.model.AdsToggleResponse
import com.kreativekoala.vibecoder.data.model.DeleteRequest
import com.kreativekoala.vibecoder.data.model.DeployRequest
import com.kreativekoala.vibecoder.data.model.DeployResponse
import com.kreativekoala.vibecoder.data.model.DeployStatusResponse
import com.kreativekoala.vibecoder.data.model.SuccessResponse
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeployRepository @Inject constructor(
    private val api: VibeBuildApi
) {

    suspend fun deploy(projectId: String, userId: String, subdomain: String): DeployResponse {
        return api.deploy(projectId, DeployRequest(userId = userId, subdomain = subdomain))
    }

    suspend fun getDeployStatus(projectId: String): DeployStatusResponse {
        return api.getDeployStatus(projectId)
    }

    suspend fun undeploy(projectId: String, userId: String): SuccessResponse {
        return api.undeploy(projectId, DeleteRequest(userId = userId))
    }

    suspend fun toggleAds(projectId: String, userId: String, enabled: Boolean): AdsToggleResponse {
        return api.toggleAds(projectId, AdsToggleRequest(userId = userId, enabled = enabled))
    }
}
