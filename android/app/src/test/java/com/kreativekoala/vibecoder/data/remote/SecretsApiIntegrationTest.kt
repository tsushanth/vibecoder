package com.kreativekoala.vibecoder.data.remote

import com.kreativekoala.vibecoder.data.repository.SecretsFailure
import com.kreativekoala.vibecoder.data.repository.SecretsRepository
import com.kreativekoala.vibecoder.data.repository.SecretsResult
import com.kreativekoala.vibecoder.di.AppModule
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.logging.Handler
import java.util.logging.LogRecord
import java.util.logging.Logger

/** The key calls over the real Retrofit + Gson + OkHttp wiring used by the app, against a MockWebServer. */
class SecretsApiIntegrationTest {
    private lateinit var server: MockWebServer
    private lateinit var api: VibeBuildApi
    private lateinit var repo: SecretsRepository

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        val client = AppModule.provideOkHttpClient(AuthInterceptor(object : AccessTokenProvider { override fun tokenFor(host: String): String? = "tok-abc" }))
        api = AppModule.provideRetrofit(client, AppModule.provideGson()).newBuilder().baseUrl(server.url("/")).build().create(VibeBuildApi::class.java)
        repo = SecretsRepository(api)
    }

    @After fun tearDown() { server.shutdown() }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test fun list_parsesNamesRequiredKeysAndPayInfo() = runBlocking {
        server.enqueue(json("""{"secrets":[{"name":"A_KEY","updatedAt":"2026-10-07T00:00:00Z"}],"required":[{"name":"A_KEY","connectors":["a"]},{"name":"STRIPE_SECRET_KEY","connectors":["pay"],"purpose":"Your Stripe secret key"}],"pay":{"webhookUrl":"https://p.example/app/pay/webhook"}}"""))
        val r = repo.list("proj-1") as SecretsResult.Ok
        assertEquals(listOf("A_KEY"), r.value.secrets!!.map { it.name })
        assertEquals(listOf("A_KEY", "STRIPE_SECRET_KEY"), r.value.required!!.map { it.name })
        assertEquals("https://p.example/app/pay/webhook", r.value.pay!!.webhookUrl)
        val req = server.takeRequest()
        assertEquals("GET", req.method); assertEquals("/api/projects/proj-1/secrets", req.path)
        assertEquals("Bearer tok-abc", req.getHeader("Authorization"))
    }

    @Test fun set_putsOnlyTheValueToTheKeyPathWithTheToken() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(204))
        assertEquals(SecretsResult.Ok(Unit), repo.set("proj-1", "WEATHER_KEY", "sk-abc"))
        val req = server.takeRequest()
        assertEquals("PUT", req.method); assertEquals("/api/projects/proj-1/secrets/WEATHER_KEY", req.path)
        assertEquals("""{"value":"sk-abc"}""", req.body.readUtf8())
        assertEquals("Bearer tok-abc", req.getHeader("Authorization"))
        assertEquals(1, server.requestCount)
    }

    @Test fun remove_deletesTheKeyPath() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(204))
        assertEquals(SecretsResult.Ok(Unit), repo.remove("proj-1", "WEATHER_KEY"))
        val req = server.takeRequest()
        assertEquals("DELETE", req.method); assertEquals("/api/projects/proj-1/secrets/WEATHER_KEY", req.path)
    }

    @Test fun serverAnswersMapToFailuresAndNeverCarryTheValue() = runBlocking {
        fun failure(r: SecretsResult<*>) = (r as SecretsResult.Failed).failure
        server.enqueue(json("""{"error":"secret_store_unavailable"}""", 502)); assertEquals(SecretsFailure.StoreDown, failure(repo.set("p", "A_KEY", "v")))
        server.enqueue(json("""{"error":"forbidden"}""", 403)); assertEquals(SecretsFailure.Forbidden, failure(repo.set("p", "A_KEY", "v")))
        server.enqueue(json("""{"error":"unauthorized"}""", 401)); assertEquals(SecretsFailure.Unauthorized, failure(repo.list("p")))
        server.enqueue(json("""{"error":"secrets_unavailable"}""", 503)); assertEquals(SecretsFailure.Unavailable, failure(repo.list("p")))
        server.enqueue(json("""{"error":"not_found"}""", 404)); assertEquals(SecretsFailure.Unavailable, failure(repo.list("p")))
        server.enqueue(json("""{"error":"rate_limited"}""", 429)); assertEquals(SecretsFailure.RateLimited, failure(repo.set("p", "A_KEY", "v")))
        server.enqueue(json("""{"error":"invalid_value"}""", 400)); assertEquals(SecretsFailure.InvalidValue, failure(repo.set("p", "A_KEY", "v")))
    }

    @Test fun aDroppedConnectionIsANetworkFailure() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        assertEquals(SecretsFailure.Network, (repo.list("p") as SecretsResult.Failed).failure)
    }

    @Test fun theValueAndTheTokenAreNotWrittenToTheHttpLog() = runBlocking {
        val lines = mutableListOf<String>()
        val logger = Logger.getLogger("okhttp3.OkHttpClient")
        val handler = object : Handler() {
            override fun publish(record: LogRecord) { lines += record.message.orEmpty() }
            override fun flush() {}
            override fun close() {}
        }
        logger.addHandler(handler)
        try {
            server.enqueue(MockResponse().setResponseCode(204))
            repo.set("proj-1", "WEATHER_KEY", "sk-very-secret-value")
        } finally { logger.removeHandler(handler) }
        assertTrue("expected the HTTP logger to have written something", lines.isNotEmpty())
        val all = lines.joinToString("\n")
        assertFalse(all.contains("sk-very-secret-value")); assertFalse(all.contains("tok-abc"))
    }
}
