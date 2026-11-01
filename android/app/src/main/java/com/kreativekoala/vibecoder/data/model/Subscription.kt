package com.kreativekoala.vibecoder.data.model

import com.google.gson.annotations.SerializedName

enum class SubscriptionTier(val value: String) {
    FREE("free"),
    PRO("pro"),
    TEAM("team"),
    ENTERPRISE("enterprise");

    companion object {
        fun fromString(value: String): SubscriptionTier =
            entries.find { it.value == value } ?: FREE
    }
}

data class SubscriptionPlan(
    val tier: String,
    val name: String,
    val price: String,
    val period: String? = null,
    val features: List<String> = emptyList()
)

data class UsageRecord(
    val id: String? = null,
    @SerializedName("user_id") val userId: String,
    @SerializedName("action_type") val actionType: String,
    @SerializedName("project_id") val projectId: String? = null,
    @SerializedName("created_at") val createdAt: String? = null
)

data class SubscriptionStatus(
    val tier: String,
    val status: String? = null,
    @SerializedName("expires_at") val expiresAt: String? = null,
    val platform: String? = null,
    val limits: SubscriptionLimits? = null
)

data class SubscriptionLimits(
    // The server (backend/services/subscriptionService.js) sends camelCase keys; the snake_case names are what this model
    // originally (and wrongly) expected, kept as alternates. Reading only the snake_case keys left every value null, so the
    // app fell back to a hard-coded limit.
    @SerializedName("dailyGenerations", alternate = ["daily_generations"]) val dailyGenerations: Int? = null,
    @SerializedName("tweaksPerProject", alternate = ["tweaks_per_project"]) val tweaksPerProject: Int? = null,
    @SerializedName("canCreatePrivateProjects", alternate = ["can_create_private"]) val canCreatePrivate: Boolean = false,
    @SerializedName("priorityQueue", alternate = ["priority_queue"]) val priorityQueue: Boolean = false,
    val unlimited: Boolean = false
)
