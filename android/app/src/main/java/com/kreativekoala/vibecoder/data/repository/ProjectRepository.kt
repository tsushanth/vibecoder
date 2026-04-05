package com.kreativekoala.vibecoder.data.repository

import com.google.gson.Gson
import com.kreativekoala.vibecoder.data.model.*
import com.kreativekoala.vibecoder.data.remote.SseStreamReader
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import com.kreativekoala.vibecoder.util.Constants
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProjectRepository @Inject constructor(
    private val api: VibeBuildApi,
    private val sseStreamReader: SseStreamReader,
    private val supabase: SupabaseClient,
    private val gson: Gson
) {

    private fun getAccessToken(): String? {
        return supabase.auth.currentAccessTokenOrNull()
    }

    suspend fun getMyProjects(userId: String): List<Project> {
        val response = api.getMyProjects(userId)
        return response.projects
    }

    suspend fun getProject(id: String): Project? {
        val response = api.getProject(id)
        return response.project
    }

    suspend fun deleteProject(id: String, userId: String) {
        api.deleteProject(id, DeleteRequest(userId))
    }

    suspend fun browseProjects(
        sort: String = "newest",
        limit: Int = 50,
        search: String? = null
    ): List<Project> {
        val response = api.browseProjects(sort = sort, limit = limit, search = search)
        return response.projects
    }

    suspend fun getSuggestions(): List<Suggestion> {
        val response = api.getSuggestions()
        return response.suggestions
    }

    suspend fun suggestNewIdeas(): List<Suggestion> {
        val response = api.suggestNewIdeas()
        return response.suggestions
    }

    suspend fun saveProject(
        title: String,
        description: String?,
        bundle: String,
        creatorId: String,
        creatorName: String?,
        initialPrompt: String?,
        isPublic: Boolean = true
    ): String? {
        val response = api.saveProject(
            SaveProjectRequest(
                title = title,
                description = description,
                bundle = bundle,
                creatorId = creatorId,
                creatorName = creatorName,
                initialPrompt = initialPrompt,
                isPublic = isPublic
            )
        )
        return response.projectId
    }

    suspend fun forkProject(
        projectId: String,
        userId: String,
        userName: String?,
        newTitle: String?
    ): String? {
        val response = api.forkProject(
            projectId,
            ForkRequest(userId = userId, userName = userName, newTitle = newTitle)
        )
        return response.projectId
    }

    fun generate(
        prompt: String,
        userId: String,
        userName: String? = null,
        referenceImage: String? = null
    ): Flow<SseEvent> {
        val request = GenerateRequest(
            prompt = prompt,
            userId = userId,
            userName = userName,
            referenceImage = referenceImage
        )
        val jsonBody = gson.toJson(request)
        return sseStreamReader.stream(
            url = "${Constants.BASE_URL}api/projects/generate",
            jsonBody = jsonBody
        )
    }

    fun tweak(
        projectId: String,
        userId: String,
        tweakDescription: String
    ): Flow<SseEvent> {
        val request = TweakRequest(
            userId = userId,
            tweakDescription = tweakDescription
        )
        val jsonBody = gson.toJson(request)
        return sseStreamReader.stream(
            url = "${Constants.BASE_URL}api/projects/$projectId/tweak",
            jsonBody = jsonBody
        )
    }

    suspend fun sendFeedback(projectId: String, userId: String, rating: String) {
        api.sendFeedback(projectId, FeedbackRequest(userId, rating))
    }

    suspend fun getVersions(projectId: String): List<AppVersion> {
        val response = api.getVersions(projectId)
        return response.versions
    }

    suspend fun revertToVersion(projectId: String, sha: String, userId: String): RevertResponse {
        return api.revertToVersion(projectId, sha, RevertRequest(userId))
    }

    suspend fun exportApk(projectId: String, userId: String, bundle: String? = null): ExportApkResponse {
        return api.exportApk(projectId, ExportApkRequest(userId, bundle))
    }
}
