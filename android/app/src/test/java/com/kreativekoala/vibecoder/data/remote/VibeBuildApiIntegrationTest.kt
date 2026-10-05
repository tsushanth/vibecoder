package com.kreativekoala.vibecoder.data.remote

import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.di.AppModule
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Real Retrofit + Gson + OkHttp (AuthInterceptor) wiring as in AppModule, against a MockWebServer. */
class VibeBuildApiIntegrationTest {
    private lateinit var server: MockWebServer
    private lateinit var api: VibeBuildApi
    private val gson = AppModule.provideGson()
    private var testToken: String? = null

    private fun buildApi(readTimeoutMs: Long? = null): VibeBuildApi {
        var client: OkHttpClient = AppModule.provideOkHttpClient(AuthInterceptor(object : AccessTokenProvider { override fun tokenFor(host: String): String? = testToken }))
        if (readTimeoutMs != null) client = client.newBuilder().readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(false).build()
        return AppModule.provideRetrofit(client, gson).newBuilder().baseUrl(server.url("/")).build()
            .create(VibeBuildApi::class.java)
    }

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        api = buildApi()
    }

    @After fun tearDown() { server.shutdown() }

    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test fun sends_bearer_token_when_signed_in_and_none_when_signed_out() = runBlocking {
        val body = """{"success":true,"status":"building","phase":"Polish","percent":71.0,"events":[]}"""
        testToken = "tok-123"
        server.enqueue(json(body)); api.getProgress("abc")
        assertEquals("Bearer tok-123", server.takeRequest().getHeader("Authorization"))
        testToken = null
        server.enqueue(json(body)); api.getProgress("abc")
        assertEquals(null, server.takeRequest().getHeader("Authorization"))
    }

    @Test fun token_policy_only_matches_our_api_host() {
        assertEquals(true, SupabaseAccessTokenProvider.isApiHost("vibecoder-api.fly.dev"))
        assertEquals(true, SupabaseAccessTokenProvider.isApiHost("VIBECODER-API.FLY.DEV"))
        assertEquals(false, SupabaseAccessTokenProvider.isApiHost("evil.example.com"))
        assertEquals(false, SupabaseAccessTokenProvider.isApiHost("vibecoder-api.fly.dev.evil.com"))
    }

    @Test fun progress_parses_and_sends_platform_header() = runBlocking {
        server.enqueue(json("""{"success":true,"status":"building","phase":"Polish","percent":71.0,"events":[{"message":"m"}]}"""))
        val p = api.getProgress("abc")
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("/api/projects/abc/progress", req.path)
        assertEquals("android", req.getHeader("x-platform"))
        assertEquals("Polish", p.phase)
        assertEquals(71.0, p.percent, 0.0)
        assertEquals("m", p.events!![0].message)
    }

    @Test fun progress_404_becomes_null_in_repository() = runBlocking {
        server.enqueue(json("""{"error":"nf"}""", 404))
        val repo = ProjectRepository(api, mockk(relaxed = true), mockk(relaxed = true), gson)
        assertNull(repo.getProgress("abc"))
    }

    @Test fun progress_503_is_rethrown_by_repository() {
        server.enqueue(json("""{"error":"down"}""", 503))
        val repo = ProjectRepository(api, mockk(relaxed = true), mockk(relaxed = true), gson)
        val e = assertThrows(HttpException::class.java) { runBlocking { repo.getProgress("abc") } }
        assertEquals(503, e.code())
    }

    @Test fun progress_read_timeout_throws_io() {
        server.enqueue(json("""{"status":"building"}""").setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val slow = buildApi(readTimeoutMs = 300)
        assertThrows(IOException::class.java) { runBlocking { slow.getProgress("abc") } }
    }

    @Test fun plan_posts_prompt_and_parses_plan() = runBlocking {
        server.enqueue(json("""{"success":true,"plan":{"summary":"S","features":["a","b"],"style":"Neon"}}"""))
        val repo = ProjectRepository(api, mockk(relaxed = true), mockk(relaxed = true), gson)
        val plan = repo.plan("make a todo app")
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/projects/plan", req.path)
        assertEquals("make a todo app", gson.fromJson(req.body.readUtf8(), Map::class.java)["prompt"])
        assertEquals("S", plan!!.summary)
        assertEquals(listOf("a", "b"), plan.features)
    }

    @Test fun plan_404_503_and_garbage_yield_null() = runBlocking {
        val repo = ProjectRepository(api, mockk(relaxed = true), mockk(relaxed = true), gson)
        server.enqueue(json("{}", 404)); assertNull(repo.plan("x"))
        server.enqueue(json("{}", 503)); assertNull(repo.plan("x"))
        server.enqueue(json("<html>bad gateway</html>", 200)); assertNull(repo.plan("x"))
        server.enqueue(json("""{"success":true,"plan":{"summary":"","features":[]}}""")); assertNull(repo.plan("x"))
        server.enqueue(json("""{"success":false,"plan":{"summary":"S"}}""")); assertNull(repo.plan("x"))
    }

    @Test fun plan_timeout_yields_null() = runBlocking {
        server.enqueue(json("{}").setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val repo = ProjectRepository(buildApi(300), mockk(relaxed = true), mockk(relaxed = true), gson)
        assertNull(repo.plan("x"))
    }

    @Test fun myProjects_sends_paging_params() = runBlocking {
        server.enqueue(json("""{"success":true,"totalCount":5,"hasMore":true,"projects":[{"id":"1","title":"t"}]}"""))
        val r = api.getMyProjects("u1", limit = 10, offset = 20)
        val req = server.takeRequest()
        assertEquals("/api/projects/my?userId=u1&limit=10&offset=20", req.path)
        assertEquals(5, r.totalCount)
        assertTrue(r.hasMore)
        assertEquals(1, r.projects.size)
    }

    @Test fun myProjects_defaults_limit50_offset0() = runBlocking {
        server.enqueue(json("""{"success":true,"projects":[]}"""))
        api.getMyProjects("u1")
        assertEquals("/api/projects/my?userId=u1&limit=50&offset=0", server.takeRequest().path)
    }

    private fun page(n: Int, hasMore: Boolean, total: Int): MockResponse {
        val items = (1..n).joinToString(",") { """{"id":"p$it","title":"t$it"}""" }
        return json("""{"success":true,"totalCount":$total,"hasMore":$hasMore,"projects":[$items]}""")
    }

    @Test fun countMyProjects_pages_until_exhausted() = runBlocking {
        server.enqueue(page(100, true, 230))
        server.enqueue(page(100, true, 230))
        server.enqueue(page(30, false, 230))
        val repo = ProjectRepository(api, mockk(relaxed = true), mockk(relaxed = true), gson)
        assertEquals(230, repo.countMyProjects("u1"))
        assertEquals(3, server.requestCount)
        server.takeRequest()
        assertEquals("/api/projects/my?userId=u1&limit=100&offset=100", server.takeRequest().path)
        assertEquals("/api/projects/my?userId=u1&limit=100&offset=200", server.takeRequest().path)
    }

    @Test fun countMyProjects_empty_page_stops_even_if_hasMore() = runBlocking {
        server.enqueue(json("""{"success":true,"totalCount":0,"hasMore":true,"projects":[]}"""))
        val repo = ProjectRepository(api, mockk(relaxed = true), mockk(relaxed = true), gson)
        assertEquals(0, repo.countMyProjects("u1"))
        assertEquals(1, server.requestCount)
    }

    @Test fun countMyProjects_uses_server_total_when_larger() = runBlocking {
        server.enqueue(page(2, false, 9))
        val repo = ProjectRepository(api, mockk(relaxed = true), mockk(relaxed = true), gson)
        assertEquals(9, repo.countMyProjects("u1"))
    }

    @Test fun countMyProjects_error_propagates() {
        server.enqueue(json("{}", 500))
        val repo = ProjectRepository(api, mockk(relaxed = true), mockk(relaxed = true), gson)
        assertThrows(HttpException::class.java) { runBlocking { repo.countMyProjects("u1") } }
    }

    @Test fun browse_sends_sort_limit_offset_and_search() = runBlocking {
        server.enqueue(json("""{"success":true,"totalCount":1,"hasMore":false,"projects":[{"id":"z","title":"Snake"}]}"""))
        val r = api.browseProjects(sort = "popular", limit = 20, offset = 40, search = "snake game")
        val url = server.takeRequest().requestUrl!!
        assertEquals("/api/projects/browse", url.encodedPath)
        assertEquals("popular", url.queryParameter("sort"))
        assertEquals("20", url.queryParameter("limit"))
        assertEquals("40", url.queryParameter("offset"))
        assertEquals("snake game", url.queryParameter("search"))
        assertEquals("Snake", r.projects.single().title)
    }

    @Test fun browse_omits_search_when_null() = runBlocking {
        server.enqueue(json("""{"success":true,"projects":[]}"""))
        api.browseProjects()
        val url = server.takeRequest().requestUrl!!
        assertNull(url.queryParameter("search"))
        assertEquals("newest", url.queryParameter("sort"))
    }

    @Test fun browse_503_throws_HttpException() {
        server.enqueue(json("{}", 503))
        val e = assertThrows(HttpException::class.java) { runBlocking { api.browseProjects() } }
        assertEquals(503, e.code())
    }

    @Test fun browse_malformed_json_throws() {
        server.enqueue(json("{not json", 200))
        assertThrows(Exception::class.java) { runBlocking { api.browseProjects() } }
    }

    @Test fun subscription_status_infinity_limits_null() = runBlocking {
        server.enqueue(json("""{"success":true,"tier":"pro","limits":{"daily_generations":null,"unlimited":true}}"""))
        val s = api.getSubscriptionStatus("u1")
        assertEquals("/api/subscriptions/status?userId=u1", server.takeRequest().path)
        assertNull(s.limits!!.dailyGenerations)
    }
}
