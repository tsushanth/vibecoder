package com.kreativekoala.vibecoder.data.remote

import com.kreativekoala.vibecoder.data.model.UpdateListingRequest
import com.kreativekoala.vibecoder.di.AppModule
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Show on Explore is the same call the web Publish dialog makes: PATCH /api/projects/:id with { userId, isPublic }. */
class ExploreListingApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: VibeBuildApi

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val client = AppModule.provideOkHttpClient(AuthInterceptor(object : AccessTokenProvider { override fun tokenFor(host: String): String? = "tok-123" }))
        api = AppModule.provideRetrofit(client, AppModule.provideGson()).newBuilder().baseUrl(server.url("/")).build()
            .create(VibeBuildApi::class.java)
    }

    @After fun tearDown() { server.shutdown() }

    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test fun sendsPatchWithTheUserIdAndIsPublic() = runBlocking {
        server.enqueue(json("""{"success":true,"project":{"id":"p1"}}"""))
        assertTrue(api.setListing("p1", UpdateListingRequest("u1", true)).success)
        val req = server.takeRequest()
        assertEquals("PATCH", req.method)
        assertEquals("/api/projects/p1", req.path)
        assertEquals("Bearer tok-123", req.getHeader("Authorization"))
        assertEquals("""{"userId":"u1","isPublic":true}""", req.body.readUtf8())
    }

    @Test fun readsIsPublicFromTheCamelCaseProjectResponse() = runBlocking {
        server.enqueue(json("""{"success":true,"project":{"id":"p1","title":"T","isPublic":false}}"""))
        assertFalse(api.getProject("p1").project!!.isPublic)
    }

    @Test fun readsIsPublicFromTheSnakeCaseListResponse() = runBlocking {
        server.enqueue(json("""{"success":true,"projects":[{"id":"p1","title":"T","is_public":false}]}"""))
        assertFalse(api.getMyProjects("u1").projects.first().isPublic)
    }
}
