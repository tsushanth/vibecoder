package com.kreativekoala.vibecoder.data.model

import com.google.gson.annotations.SerializedName

data class Project(
    val id: String,
    val title: String,
    val description: String? = null,
    val bundle: String? = null,
    @SerializedName("creator_id") val creatorId: String,
    @SerializedName("creator_name") val creatorName: String? = null,
    @SerializedName("project_type") val projectType: String = "web_app",
    @SerializedName("is_public") val isPublic: Boolean = true,
    @SerializedName("is_featured") val isFeatured: Boolean = false,
    @SerializedName("play_count") val playCount: Int = 0,
    @SerializedName("view_count") val viewCount: Int = 0,
    @SerializedName("fork_count") val forkCount: Int = 0,
    val rating: Double = 0.0,
    @SerializedName("initial_prompt") val initialPrompt: String? = null,
    @SerializedName("github_repo") val githubRepo: String? = null,
    @SerializedName("tweak_count") val tweakCount: Int = 0,
    @SerializedName("free_tweaks_remaining") val freeTweaksRemaining: Int = 5,
    @SerializedName("published_url") val publishedUrl: String? = null,
    @SerializedName("preview_url") val previewUrl: String? = null,
    @SerializedName("thumbnail_url") val thumbnailUrl: String? = null,
    val status: String? = "ready",
    @SerializedName("parent_project_id") val parentProjectId: String? = null,
    @SerializedName("creation_method") val creationMethod: String = "ai_generated",
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("updated_at") val updatedAt: String? = null
)

data class ProjectFile(
    val name: String,
    val size: Int? = null,
    val type: String? = null,
    val content: String? = null
)
