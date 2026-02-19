package com.kreativekoala.vibecoder.data.remote

import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor() : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder()
            .addHeader("x-platform", "android")
            .addHeader("Content-Type", "application/json")
            .build()
        return chain.proceed(request)
    }
}
