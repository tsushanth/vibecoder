package com.kreativekoala.vibecoder.data.repository

import com.kreativekoala.vibecoder.data.model.*
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CoinRepository @Inject constructor(
    private val api: VibeBuildApi
) {

    suspend fun getBalance(userId: String): CoinBalanceResponse {
        return api.getCoinBalance(userId)
    }

    suspend fun getStore(): CoinStoreResponse {
        return api.getCoinStore()
    }

    suspend fun spendCoins(
        userId: String,
        reason: String,
        projectId: String? = null,
        creatorId: String? = null
    ): SpendCoinsResponse {
        return api.spendCoins(
            SpendCoinsRequest(
                userId = userId,
                reason = reason,
                projectId = projectId,
                creatorId = creatorId
            )
        )
    }

    suspend fun purchaseCoins(
        userId: String,
        productId: String,
        transactionId: String
    ): PurchaseCoinsResponse {
        return api.purchaseCoins(
            PurchaseCoinsRequest(
                userId = userId,
                productId = productId,
                transactionId = transactionId
            )
        )
    }
}
