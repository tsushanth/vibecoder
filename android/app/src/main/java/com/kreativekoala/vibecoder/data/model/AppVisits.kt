package com.kreativekoala.vibecoder.data.model

import com.google.gson.annotations.SerializedName
import java.net.URI

/**
 * Visits to one published app (GET api/visits). [openUrl] is the app's address with a short-lived signature: opening it
 * leaves this browser out of the count, so the creator does not count as a visitor.
 */
data class AppVisits(
    @SerializedName("projectId") val projectId: String? = null,
    @SerializedName("url") val url: String? = null,
    @SerializedName("openUrl") val openUrl: String? = null,
    @SerializedName("today") val today: Int? = null,
    @SerializedName("last7Days") val last7Days: Int? = null,
    @SerializedName("total") val total: Int? = null
) {
    /** Gson fills missing fields with null: such an entry is left out rather than shown as zero. */
    val isComplete: Boolean get() = projectId != null && url != null && openUrl != null && today != null && last7Days != null && total != null
}

data class VisitsResponse(
    @SerializedName("countingSince") val countingSince: String? = null,
    @SerializedName("apps") val apps: List<AppVisits>? = null
) {
    fun byProject(): Map<String, AppVisits> = apps.orEmpty().filter { it.isComplete }.associateBy { it.projectId!! }
}

object OwnerLink {
    /** The address to open for the creator: the signed one when it is for this same site, else the plain address. */
    fun forUrl(liveUrl: String, visits: AppVisits?): String {
        val signed = visits?.openUrl ?: return liveUrl
        val host = { u: String -> runCatching { URI(u).host }.getOrNull() }
        return if (signed.startsWith("https://") && host(signed) != null && host(signed) == host(liveUrl)) signed else liveUrl
    }
}
