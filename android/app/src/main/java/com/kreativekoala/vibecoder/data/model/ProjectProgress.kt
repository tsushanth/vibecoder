package com.kreativekoala.vibecoder.data.model

/** One entry in the server-side build log (GET api/projects/{id}/progress). */
data class ProgressEvent(
    val ts: String? = null,
    val phase: String? = null,
    val message: String? = null
)

/**
 * Response of GET api/projects/{id}/progress. Every field is defaulted so a
 * partially-populated payload from the backend never crashes the client.
 * status: "building" | "ready" | "failed".
 */
data class ProjectProgress(
    val success: Boolean = true,
    val status: String = "building",
    val phase: String = "",
    val detail: String = "",
    val percent: Double = 0.0,
    val startedAt: String? = null,
    val events: List<ProgressEvent>? = null,
    val error: String? = null
)

data class PlanRequest(val prompt: String)

data class BuildPlan(
    val summary: String = "",
    val features: List<String>? = null,
    val style: String = ""
)

/** Response of optional POST api/projects/plan. */
data class PlanResponse(
    val success: Boolean = false,
    val plan: BuildPlan? = null
)
