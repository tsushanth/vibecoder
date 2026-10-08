package com.kreativekoala.vibecoder.data.remote

import com.kreativekoala.vibecoder.data.model.*
import retrofit2.http.*

interface VibeBuildApi {

    // Auth
    @POST("api/auth/register")
    suspend fun register(@Body body: RegisterRequest): RegisterResponse

    @GET("api/users/{userId}")
    suspend fun getUser(@Path("userId") userId: String): User

    // Projects
    @GET("api/projects/my")
    suspend fun getMyProjects(
        @Query("userId") userId: String,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0
    ): MyProjectsResponse

    @GET("api/projects/{id}")
    suspend fun getProject(@Path("id") id: String): ProjectDetailResponse

    @HTTP(method = "DELETE", path = "api/projects/{id}", hasBody = true)
    suspend fun deleteProject(
        @Path("id") id: String,
        @Body body: DeleteRequest
    ): SuccessResponse

    @GET("api/projects/browse")
    suspend fun browseProjects(
        @Query("sort") sort: String = "newest",
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
        @Query("search") search: String? = null
    ): BrowseResponse

    @GET("api/projects/suggestions")
    suspend fun getSuggestions(@Query("count") count: Int = 6): SuggestionsResponse

    @POST("api/projects/suggest-ideas")
    suspend fun suggestNewIdeas(): SuggestionsResponse

    /** Live build progress. Backend may not implement this yet (404 -> caller falls back to polling). */
    @GET("api/projects/{id}/progress")
    suspend fun getProgress(@Path("id") id: String): ProjectProgress

    /** Optional "plan before build" step. */
    @POST("api/projects/plan")
    suspend fun planProject(@Body body: PlanRequest): PlanResponse

    @POST("api/projects/save")
    suspend fun saveProject(@Body body: SaveProjectRequest): SaveProjectResponse

    @POST("api/projects/{id}/retry")
    suspend fun retryProject(
        @Path("id") id: String,
        @Body body: DeleteRequest
    ): SuccessResponse

    @POST("api/projects/{id}/feedback")
    suspend fun sendFeedback(
        @Path("id") id: String,
        @Body body: FeedbackRequest
    ): SuccessResponse

    @POST("api/projects/{id}/fork")
    suspend fun forkProject(
        @Path("id") id: String,
        @Body body: ForkRequest
    ): ForkResponse

    @GET("api/projects/{id}/versions")
    suspend fun getVersions(
        @Path("id") id: String,
        @Query("limit") limit: Int = 20
    ): VersionsResponse

    @POST("api/projects/{id}/revert/{sha}")
    suspend fun revertToVersion(
        @Path("id") id: String,
        @Path("sha") sha: String,
        @Body body: RevertRequest
    ): RevertResponse

    // Subscriptions
    @GET("api/subscriptions/status")
    suspend fun getSubscriptionStatus(
        @Query("userId") userId: String
    ): SubscriptionStatusResponse

    @POST("api/subscriptions/verify")
    suspend fun verifyReceipt(@Body body: VerifyReceiptRequest): VerifyReceiptResponse

    @POST("api/subscriptions/usage")
    suspend fun recordUsage(@Body body: UsageRequest): UsageResponse

    @GET("api/subscriptions/plans")
    suspend fun getPlans(): PlansResponse

    // Creator keys for a generated app (owner only, identity from the access token; values are write-only)
    @GET("api/projects/{id}/secrets")
    suspend fun getSecrets(@Path("id") id: String): SecretsResponse

    @PUT("api/projects/{id}/secrets/{name}")
    suspend fun setSecret(
        @Path("id") id: String,
        @Path("name") name: String,
        @Body body: SecretValueRequest
    )

    @DELETE("api/projects/{id}/secrets/{name}")
    suspend fun deleteSecret(@Path("id") id: String, @Path("name") name: String)

    // Export APK
    @POST("api/projects/{id}/export-apk")
    suspend fun exportApk(
        @Path("id") id: String,
        @Body body: ExportApkRequest
    ): ExportApkResponse

    // Deploy
    @POST("api/deploy/{projectId}/deploy")
    suspend fun deploy(
        @Path("projectId") id: String,
        @Body body: DeployRequest
    ): DeployResponse

    @GET("api/deploy/{projectId}/deploy")
    suspend fun getDeployStatus(
        @Path("projectId") id: String
    ): DeployStatusResponse

    @POST("api/deploy/{projectId}/ads")
    suspend fun toggleAds(
        @Path("projectId") id: String,
        @Body body: AdsToggleRequest
    ): AdsToggleResponse

    @HTTP(method = "DELETE", path = "api/deploy/{projectId}/deploy", hasBody = true)
    suspend fun undeploy(
        @Path("projectId") id: String,
        @Body body: DeleteRequest
    ): SuccessResponse

    // Custom domains (Pro)
    @POST("api/domains/{deploymentId}/add")
    suspend fun addDomain(
        @Path("deploymentId") id: String,
        @Body body: AddDomainRequest
    ): AddDomainResponse

    @POST("api/domains/{deploymentId}/verify")
    suspend fun verifyDomain(
        @Path("deploymentId") id: String,
        @Body body: VerifyDomainRequest
    ): VerifyDomainResponse

    @GET("api/domains/{deploymentId}")
    suspend fun getDomain(
        @Path("deploymentId") id: String,
        @Query("userId") userId: String
    ): DomainInfoResponse

    @HTTP(method = "DELETE", path = "api/domains/{deploymentId}", hasBody = true)
    suspend fun removeDomain(
        @Path("deploymentId") id: String,
        @Body body: VerifyDomainRequest
    ): RemoveDomainResponse

    // Push token registration
    @POST("api/auth/push-token")
    suspend fun registerPushToken(@Body body: PushTokenRequest): SuccessResponse

    // System status (for maintenance banner)
    @GET("api/status")
    suspend fun getSystemStatus(): SystemStatusResponse

    // Health
    @GET("api/health")
    suspend fun healthCheck(): SuccessResponse
}
