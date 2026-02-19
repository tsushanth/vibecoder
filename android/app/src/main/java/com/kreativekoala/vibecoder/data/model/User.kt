package com.kreativekoala.vibecoder.data.model

import com.google.gson.annotations.SerializedName

data class User(
    @SerializedName("user_id") val userId: String,
    val email: String? = null,
    @SerializedName("display_name") val displayName: String? = null,
    @SerializedName("avatar_url") val avatarUrl: String? = null,
    @SerializedName("subscription_tier") val subscriptionTier: String = "free",
    @SerializedName("subscription_status") val subscriptionStatus: String? = null,
    @SerializedName("subscription_expires_at") val subscriptionExpiresAt: String? = null,
    @SerializedName("daily_generation_count") val dailyGenerationCount: Int = 0,
    @SerializedName("last_generation_date") val lastGenerationDate: String? = null,
    @SerializedName("total_projects") val totalProjects: Int = 0,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("updated_at") val updatedAt: String? = null
)
