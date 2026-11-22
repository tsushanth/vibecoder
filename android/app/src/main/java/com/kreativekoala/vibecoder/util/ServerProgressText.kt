package com.kreativekoala.vibecoder.util

import android.content.Context
import androidx.annotation.StringRes
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.data.model.ProgressEvent

/**
 * The build worker sends its progress text in English ("Building your app: ...", "Packaging app: Creating bundle").
 * Shown as is, it leaves English lines on the build screen of a person using the app in another language. When the app is
 * not in English this swaps that text for the already translated phase names, chosen by the phase key the server sends
 * (generate, validate, fix, polish, verify, package). In English the server text is shown untouched.
 */
object ServerProgressText {
    /** The string for a server phase key; unknown phases and the packaging step show the generic "Working on it". */
    @StringRes
    fun resFor(phase: String?, tweak: Boolean = false): Int = when (phase?.trim()?.lowercase()) {
        "generate" -> if (tweak) R.string.progress_applying_changes else R.string.build_phase_generate
        "validate" -> R.string.build_phase_validate
        "fix" -> R.string.build_phase_fix
        "polish" -> R.string.build_phase_polish
        "verify" -> R.string.build_phase_verify
        else -> R.string.build_chat_working
    }

    /** Server text in the app language: unchanged for English or blank text, otherwise the phase's translated name. */
    fun localize(context: Context, phase: String?, serverText: String, tweak: Boolean = false, language: String = AppLanguage.current()): String =
        if (serverText.isBlank() || language == "en") serverText else context.appString(resFor(phase, tweak))

    /** Polled progress events with their text localized and consecutive repeats of the same line dropped. */
    fun localizeEvents(context: Context, events: List<ProgressEvent>, language: String = AppLanguage.current()): List<ProgressEvent> {
        if (language == "en") return events
        val out = ArrayList<ProgressEvent>()
        for (e in events) {
            val text = e.message?.takeIf { it.isNotBlank() } ?: continue
            val local = localize(context, e.phase, text, language = language)
            if (out.lastOrNull()?.message != local) out.add(e.copy(message = local))
        }
        return out
    }
}
