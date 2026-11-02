package com.kreativekoala.vibecoder.data.remote

import com.kreativekoala.vibecoder.data.model.DeleteRequest
import com.kreativekoala.vibecoder.di.AppModule
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException

/** The account-deletion call is the same one the web settings page makes: DELETE /api/auth/account with the user's own token. */
class AccountDeletionApiTest {
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

    @Test fun sends_delete_with_the_users_token_and_id() = runBlocking {
        server.enqueue(json("""{"success":true,"message":"Account deleted successfully"}"""))
        val res = api.deleteAccount(DeleteRequest("u1"))
        assertTrue(res.success)
        val req = server.takeRequest()
        assertEquals("DELETE", req.method)
        assertEquals("/api/auth/account", req.path)
        assertEquals("Bearer tok-123", req.getHeader("Authorization"))
        assertEquals("""{"userId":"u1"}""", req.body.readUtf8())
    }

    @Test fun a_401_is_thrown_so_the_caller_can_ask_to_sign_in_again() = runBlocking {
        server.enqueue(json("""{"error":"Sign in again to delete your account."}""", 401))
        val err = try { api.deleteAccount(DeleteRequest("u1")); null } catch (e: HttpException) { e }
        assertEquals(401, err!!.code())
    }
}
