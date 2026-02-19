package com.kreativekoala.vibecoder.data.repository

import com.kreativekoala.vibecoder.data.model.*
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SubscriptionRepository @Inject constructor(
    private val api: VibeBuildApi
) {

    suspend fun getSubscriptionStatus(userId: String): SubscriptionStatusResponse {
        return api.getSubscriptionStatus(userId)
    }

    suspend fun verifyReceipt(
        userId: String,
        purchaseToken: String
    ): VerifyReceiptResponse {
        return api.verifyReceipt(
            VerifyReceiptRequest(
                userId = userId,
                platform = "android",
                receiptData = purchaseToken
            )
        )
    }

    suspend fun recordUsage(
        userId: String,
        actionType: String,
        projectId: String? = null
    ): UsageResponse {
        return api.recordUsage(
            UsageRequest(
                userId = userId,
                actionType = actionType,
                projectId = projectId
            )
        )
    }

    suspend fun getPlans(): List<SubscriptionPlan> {
        val response = api.getPlans()
        return response.plans
    }
}
