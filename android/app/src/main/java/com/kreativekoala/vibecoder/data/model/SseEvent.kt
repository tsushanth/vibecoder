package com.kreativekoala.vibecoder.data.model

import com.google.gson.annotations.SerializedName

sealed class SseEvent {
    data class Queued(
        @SerializedName("projectId") val projectId: String
    ) : SseEvent()

    data class Status(
        val phase: String = "",
        val message: String = "",
        val detail: String = "",
        @SerializedName("progress_percent") val progressPercent: Double = 0.0,
        @SerializedName("progressPercent") val progressPercentAlt: Double? = null,
        @SerializedName("progress_end_pct") val progressEndPct: Double? = null,
        @SerializedName("progressEndPct") val progressEndPctAlt: Double? = null,
        @SerializedName("phase_duration_seconds") val phaseDurationSeconds: Double? = null,
        @SerializedName("phaseDurationSeconds") val phaseDurationSecondsAlt: Double? = null,
        @SerializedName("estimated_seconds_remaining") val estimatedSecondsRemaining: Double? = null,
        @SerializedName("estimatedSecondsRemaining") val estimatedSecondsRemainingAlt: Double? = null
    ) : SseEvent() {
        fun resolvedProgress(): Double = progressPercentAlt ?: progressPercent
        fun resolvedEta(): Double? = estimatedSecondsRemainingAlt ?: estimatedSecondsRemaining
    }

    data class Result(
        val success: Boolean = true,
        val bundle: String = "",
        @SerializedName("projectId") val projectId: String? = null,
        @SerializedName("previewUrl") val previewUrl: String? = null,
        @SerializedName("bundle_size") val bundleSize: Int? = null,
        @SerializedName("bundleSize") val bundleSizeAlt: Int? = null,
        val files: List<ProjectFile>? = null,
        @SerializedName("generation_time") val generationTime: String? = null,
        @SerializedName("generationTime") val generationTimeAlt: String? = null
    ) : SseEvent()

    data class Error(
        val error: String,
        @SerializedName("systemBusy") val systemBusy: Boolean = false
    ) : SseEvent()
}
