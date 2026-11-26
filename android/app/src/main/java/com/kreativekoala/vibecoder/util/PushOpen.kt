package com.kreativekoala.vibecoder.util

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** A tapped notification: which app it was about and what kind of notice it was. */
data class PushTap(val projectId: String?, val kind: String)

/** Holds a tapped notification until the signed-in main screen can open it. */
object PushOpen {
    const val EXTRA_PROJECT_ID = "projectId" // the server's data keys: a background notice delivers them as intent extras
    const val EXTRA_KIND = "kind"

    private val kinds = setOf("build_ready", "build_failed", "other")
    private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    /** Null unless the extras are those of one of our notices. Any app can start the activity, so nothing else is accepted. */
    fun parse(projectId: String?, kind: String?): PushTap? {
        if (kind == null || kind !in kinds) return null
        return PushTap(projectId?.takeIf { uuid.matches(it) }, kind)
    }

    private val pendingTap = MutableStateFlow<PushTap?>(null)
    val pending: StateFlow<PushTap?> = pendingTap

    fun offer(tap: PushTap?) {
        if (tap != null) pendingTap.value = tap
    }

    /** Returns the waiting tap once. */
    fun take(): PushTap? = pendingTap.value?.also { pendingTap.value = null }
}
