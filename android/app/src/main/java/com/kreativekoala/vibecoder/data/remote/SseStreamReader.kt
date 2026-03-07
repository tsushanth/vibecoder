package com.kreativekoala.vibecoder.data.remote

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.kreativekoala.vibecoder.data.model.SseEvent
import com.kreativekoala.vibecoder.util.Constants
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SseStreamReader @Inject constructor() {

    private val sseClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(Constants.SSE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS) // Send HTTP/2 PING frames to keep connection alive through load balancers
        .retryOnConnectionFailure(true)
        .build()

    private val gson = Gson()

    fun stream(url: String, jsonBody: String, authToken: String? = null): Flow<SseEvent> = callbackFlow {
        val requestBody = jsonBody.toRequestBody("application/json".toMediaType())
        val requestBuilder = Request.Builder()
            .url(url)
            .post(requestBody)
            .addHeader("Accept", "text/event-stream")
            .addHeader("x-platform", "android")

        if (authToken != null) {
            requestBuilder.addHeader("Authorization", "Bearer $authToken")
        }

        val request = requestBuilder.build()
        val call = sseClient.newCall(request)

        Log.d("SSE", "Starting SSE stream: $url")
        Log.d("SSE", "Body: $jsonBody")

        try {
            val response = call.execute()
            Log.d("SSE", "Response code: ${response.code}, content-type: ${response.header("Content-Type")}")

            if (!response.isSuccessful) {
                val errorBody = response.body?.string() ?: "Unknown error"
                Log.e("SSE", "HTTP error ${response.code}: $errorBody")
                val errorMessage = try {
                    gson.fromJson(errorBody, JsonObject::class.java)
                        ?.get("error")?.asString ?: errorBody
                } catch (_: Exception) {
                    errorBody
                }
                trySend(SseEvent.Error("HTTP ${response.code}: $errorMessage"))
                close()
                return@callbackFlow
            }

            val inputStream = response.body?.byteStream()
            if (inputStream == null) {
                trySend(SseEvent.Error("Empty response body"))
                close()
                return@callbackFlow
            }

            val reader = BufferedReader(InputStreamReader(inputStream))
            var line: String?

            while (reader.readLine().also { line = it } != null) {
                val currentLine = line ?: continue

                if (currentLine.startsWith("data: ")) {
                    val jsonStr = currentLine.removePrefix("data: ").trim()
                    if (jsonStr.isNotEmpty()) {
                        Log.d("SSE", "Event: $jsonStr")
                        val event = parseEvent(jsonStr)
                        if (event != null) {
                            trySend(event)
                            if (event is SseEvent.Result || event is SseEvent.Error) {
                                break
                            }
                        } else {
                            Log.w("SSE", "Failed to parse event: $jsonStr")
                        }
                    }
                } else if (currentLine.isNotBlank()) {
                    // Some SSE implementations send raw JSON without "data: " prefix
                    val jsonStr = currentLine.trim()
                    if (jsonStr.startsWith("{")) {
                        Log.d("SSE", "Raw JSON line: $jsonStr")
                        val event = parseEvent(jsonStr)
                        if (event != null) {
                            trySend(event)
                            if (event is SseEvent.Result || event is SseEvent.Error) {
                                break
                            }
                        }
                    }
                }
            }

            reader.close()
            response.close()
            Log.d("SSE", "Stream completed normally")
        } catch (e: Exception) {
            Log.e("SSE", "Stream error: ${e.message}", e)
            if (!call.isCanceled()) {
                trySend(SseEvent.Error(e.message ?: "Stream error"))
            }
        }

        close()
        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)

    private fun parseEvent(json: String): SseEvent? {
        return try {
            val obj = gson.fromJson(json, JsonObject::class.java)
            val type = obj.get("type")?.asString

            when (type) {
                "status" -> gson.fromJson(json, SseEvent.Status::class.java)
                "result" -> gson.fromJson(json, SseEvent.Result::class.java)
                "error" -> SseEvent.Error(
                    obj.get("error")?.asString ?: "Unknown error"
                )
                else -> {
                    when {
                        obj.has("bundle") -> gson.fromJson(json, SseEvent.Result::class.java)
                        obj.has("phase") || obj.has("progressPercent") || obj.has("progress_percent") || obj.has("message") ->
                            gson.fromJson(json, SseEvent.Status::class.java)
                        obj.has("error") -> SseEvent.Error(obj.get("error").asString)
                        else -> {
                            Log.w("SSE", "Unknown event type: $type, keys: ${obj.keySet()}")
                            null
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("SSE", "Parse error for: $json", e)
            null
        }
    }
}
