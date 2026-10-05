package com.kreativekoala.vibecoder.data.remote

import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val tokens: AccessTokenProvider
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val builder = original.newBuilder()
            .addHeader("x-platform", "android")
            .addHeader("Content-Type", "application/json")
        // A caller that set its own Authorization keeps it. A lookup failure behaves like being signed out.
        if (original.header("Authorization") == null) {
            val token = try { tokens.tokenFor(original.url.host) } catch (e: Exception) { null }
            if (token != null) builder.header("Authorization", "Bearer $token")
        }
        return chain.proceed(builder.build())
    }
}
