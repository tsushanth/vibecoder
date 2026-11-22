package com.kreativekoala.vibecoder.util

import android.content.Context
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.data.model.ProgressEvent
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Test

class ServerProgressTextTest {
    private val context = mockk<Context>()

    @Test fun phaseKeysMapToTheTranslatedPhaseNames() {
        assertEquals(R.string.build_phase_generate, ServerProgressText.resFor("generate"))
        assertEquals(R.string.build_phase_validate, ServerProgressText.resFor("Validate"))
        assertEquals(R.string.build_phase_fix, ServerProgressText.resFor("fix"))
        assertEquals(R.string.build_phase_polish, ServerProgressText.resFor("polish"))
        assertEquals(R.string.build_phase_verify, ServerProgressText.resFor("verify"))
    }

    @Test fun tweaksShowApplyingChangesInTheFirstPhase() {
        assertEquals(R.string.progress_applying_changes, ServerProgressText.resFor("generate", tweak = true))
        assertEquals(R.string.build_phase_validate, ServerProgressText.resFor("validate", tweak = true))
    }

    @Test fun packagingAndUnknownPhasesShowWorkingOnIt() {
        for (phase in listOf("package", "ready", "", "something_new", null)) {
            assertEquals(phase, R.string.build_chat_working, ServerProgressText.resFor(phase))
        }
    }

    @Test fun englishKeepsTheServerTextAsIs() {
        assertEquals("Building your app: todo", ServerProgressText.localize(context, "generate", "Building your app: todo", language = "en"))
        val events = listOf(ProgressEvent(phase = "package", message = "Packaging app: Creating bundle"))
        assertEquals(events, ServerProgressText.localizeEvents(context, events, language = "en"))
    }

    @Test fun blankServerTextStaysBlankInAnyLanguage() {
        assertEquals("", ServerProgressText.localize(context, "generate", "", language = "zh"))
    }
}
