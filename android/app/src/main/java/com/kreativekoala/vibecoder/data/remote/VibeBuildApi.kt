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

    @POST("api/projects/save")
    suspend fun saveProject(@Body body: SaveProjectRequest): SaveProjectResponse

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

    @HTTP(method = "DELETE", path = "api/deploy/{projectId}/deploy", hasBody = true)
    suspend fun undeploy(
        @Path("projectId") id: String,
        @Body body: DeleteRequest
    ): SuccessResponse

    // Coins
    @GET("api/coins/balance")
    suspend fun getCoinBalance(
        @Query("userId") userId: String
    ): CoinBalanceResponse

    @GET("api/coins/store")
    suspend fun getCoinStore(): CoinStoreResponse

    @POST("api/coins/spend")
    suspend fun spendCoins(@Body body: SpendCoinsRequest): SpendCoinsResponse

    @POST("api/coins/purchase")
    suspend fun purchaseCoins(@Body body: PurchaseCoinsRequest): PurchaseCoinsResponse

    // Health
    @GET("api/health")
    suspend fun healthCheck(): SuccessResponse
}
