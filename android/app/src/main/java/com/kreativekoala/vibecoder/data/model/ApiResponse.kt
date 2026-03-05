package com.kreativekoala.vibecoder.data.model

import com.google.gson.annotations.SerializedName

// --- Auth ---
data class RegisterRequest(
    val userId: String,
    val email: String?,
    val displayName: String?,
    val avatarUrl: String?
)

data class RegisterResponse(
    val success: Boolean,
    val user: User?
)

// --- Projects ---
data class MyProjectsResponse(
    val success: Boolean,
    val projects: List<Project> = emptyList(),
    @SerializedName("totalCount") val totalCount: Int = 0,
    @SerializedName("hasMore") val hasMore: Boolean = false
)

data class ProjectDetailResponse(
    val success: Boolean,
    val project: Project?
)

data class BrowseResponse(
    val success: Boolean,
    val projects: List<Project> = emptyList(),
    @SerializedName("totalCount") val totalCount: Int = 0,
    @SerializedName("hasMore") val hasMore: Boolean = false
)

data class SuggestionsResponse(
    val success: Boolean,
    val suggestions: List<Suggestion> = emptyList()
)

data class Suggestion(
    val label: String,
    val prompt: String
)

data class SaveProjectRequest(
    val title: String,
    val description: String?,
    val bundle: String,
    val creatorId: String,
    val creatorName: String?,
    val initialPrompt: String?,
    val isPublic: Boolean = true
)

data class SaveProjectResponse(
    val success: Boolean,
    @SerializedName("projectId") val projectId: String?
)

data class DeleteRequest(val userId: String)

data class ForkRequest(
    val userId: String,
    val userName: String?,
    val newTitle: String?
)

data class ForkResponse(
    val success: Boolean,
    @SerializedName("projectId") val projectId: String?
)

data class SuccessResponse(val success: Boolean)

// --- Subscriptions ---
data class SubscriptionStatusResponse(
    val success: Boolean,
    val tier: String = "free",
    val status: String? = null,
    @SerializedName("expiresAt") val expiresAt: String? = null,
    val platform: String? = null,
    val limits: SubscriptionLimits? = null
)

data class VerifyReceiptRequest(
    val userId: String,
    val platform: String = "android",
    val receiptData: String
)

data class VerifyReceiptResponse(
    val success: Boolean,
    val tier: String? = null,
    @SerializedName("expiresAt") val expiresAt: String? = null,
    @SerializedName("productId") val productId: String? = null
)

data class UsageRequest(
    val userId: String,
    val actionType: String,
    val projectId: String? = null
)

data class UsageResponse(
    val success: Boolean,
    val tier: String? = null,
    val used: Int? = null,
    val limit: Int? = null,
    val remaining: Int? = null,
    val unlimited: Boolean = false
)

data class PlansResponse(
    val success: Boolean,
    val plans: List<SubscriptionPlan> = emptyList()
)

// --- Deploy ---
data class DeployRequest(
    val userId: String,
    val subdomain: String
)

data class DeployResponse(
    val success: Boolean,
    val url: String? = null
)

data class DeployStatusResponse(
    val success: Boolean,
    val deployed: Boolean = false,
    val subdomain: String? = null,
    val url: String? = null,
    @SerializedName("deployedAt") val deployedAt: String? = null
)

// --- Coins ---
data class CoinBalanceResponse(
    val success: Boolean,
    val balance: Int = 0,
    val totalPurchased: Int = 0,
    val totalSpent: Int = 0,
    val totalEarned: Int = 0
)

data class CoinStoreResponse(
    val success: Boolean,
    val generationCost: Int = 20,
    val tweakCost: Int = 10,
    val forkCost: Int = 10,
    val creatorSharePercent: Int = 55,
    val packs: List<CoinPack> = emptyList()
)

data class CoinPack(
    val productId: String,
    val coins: Int,
    val price: String
)

data class SpendCoinsRequest(
    val userId: String,
    val reason: String,
    val projectId: String? = null,
    val creatorId: String? = null,
    val platform: String = "android"
)

data class SpendCoinsResponse(
    val success: Boolean,
    val coinsSpent: Int = 0,
    val newBalance: Int = 0,
    val error: String? = null,
    val balance: Int = 0
)

data class PurchaseCoinsRequest(
    val userId: String,
    val productId: String,
    val transactionId: String,
    val platform: String = "android"
)

data class PurchaseCoinsResponse(
    val success: Boolean,
    val coinsAdded: Int = 0,
    val newBalance: Int = 0,
    val message: String? = null
)

// --- Generation ---
data class GenerateRequest(
    val prompt: String,
    val userId: String,
    val userName: String? = null,
    val referenceImage: String? = null
)

data class TweakRequest(
    val userId: String,
    val tweakDescription: String
)
