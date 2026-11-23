package com.kreativekoala.vibecoder.ui.telegram

import com.kreativekoala.vibecoder.data.model.PromoEventRequest
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import com.kreativekoala.vibecoder.util.AppLanguage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Usage numbers for the Telegram promotion inside the app: how many people SEE each surface and how many tap it.
 *
 * Sends one small event to our own API (POST api/events/promo, stored in the first-party app_events table): the action
 * (impression, tap, dismiss), the surface, and the app language. Never any text, name or prompt. It only works for a signed-in
 * person (the API refuses anything else), is fire and forget on a background thread, and any failure is silent.
 *
 * An impression is counted once per surface per app launch (post-build: once per finished build), not on every recomposition.
 * Taps and dismissals are counted every time. The start payload the bot sees is the same surface's [Surface.payload], so impressions,
 * taps and bot starts can be read side by side (docs/channels-metrics.md).
 */
object PromoEvents {
    enum class Surface(val wire: String, val payload: String) {
        BANNER("banner", TelegramBot.PAYLOAD_BANNER),
        CREATE_CARD("create_card", TelegramBot.PAYLOAD_CARD),
        POST_BUILD("post_build", TelegramBot.PAYLOAD_BUILD),
        ACCOUNT_ROW("account_row", TelegramBot.PAYLOAD_SETTINGS),
    }

    const val ACTION_IMPRESSION = "impression"
    const val ACTION_TAP = "tap"
    const val ACTION_DISMISS = "dismiss"

    /** The surface whose link carries [payload], or null for a payload this app does not use. */
    fun surfaceForPayload(payload: String): Surface? = Surface.values().firstOrNull { it.payload == payload }

    /** Remembers which impressions were already counted in this app launch. */
    class ImpressionGate {
        private val seen = ConcurrentHashMap.newKeySet<String>()
        /** True the first time [surface] (with [key], e.g. a project id) is offered, false afterwards. */
        fun firstTime(surface: Surface, key: String = ""): Boolean = seen.add("${surface.wire}:$key")
    }

    private val gate = ImpressionGate()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var api: VibeBuildApi? = null

    /** Called once from Application.onCreate. Until then every call is a no-op. */
    fun init(api: VibeBuildApi) { this.api = api }

    fun impression(surface: Surface, key: String = "") {
        if (gate.firstTime(surface, key)) send(ACTION_IMPRESSION, surface)
    }

    fun tap(surface: Surface) = send(ACTION_TAP, surface)

    fun dismiss(surface: Surface) = send(ACTION_DISMISS, surface)

    private fun send(action: String, surface: Surface) {
        val client = api ?: return
        scope.launch {
            try {
                client.promoEvent(PromoEventRequest(action = action, surface = surface.wire, lang = AppLanguage.current()))
            } catch (e: Exception) {
                // analytics only: never surfaces to the person, never retried
            }
        }
    }
}
