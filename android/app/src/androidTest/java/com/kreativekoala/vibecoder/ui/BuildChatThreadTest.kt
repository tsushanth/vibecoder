package com.kreativekoala.vibecoder.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.onNodeWithContentDescription
import com.kreativekoala.vibecoder.data.model.BuildPlan
import com.kreativekoala.vibecoder.data.model.ProgressEvent
import com.kreativekoala.vibecoder.ui.create.BuildChatThread
import com.kreativekoala.vibecoder.ui.create.ChatStage
import com.kreativekoala.vibecoder.ui.create.CreateUiState
import com.kreativekoala.vibecoder.ui.create.TweakTurn
import com.kreativekoala.vibecoder.ui.theme.VibeBuildTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.io.File

class BuildChatThreadTest {
    @get:Rule val rule = createComposeRule()

    private val plan = BuildPlan("A tidy todo app", listOf("Add tasks", "Mark done"), "Dark and minimal")
    private val calls = mutableListOf<String>()

    private fun show(state: CreateUiState, showUpsell: Boolean = false) {
        rule.setContent {
            VibeBuildTheme {
                BuildChatThread(
                    state = state, showUpsell = showUpsell,
                    onConfirmPlan = { calls += "confirm" }, onEditPrompt = { calls += "edit" },
                    onCancel = { calls += "cancel" }, onOpenPreview = { calls += "preview" },
                    onPublish = { calls += "publish" }, onNewApp = { calls += "new" },
                    onTweak = { calls += "tweak:$it" }, onUpgrade = { calls += "upgrade" }
                )
            }
        }
    }

    private fun base(stage: ChatStage) = CreateUiState(chatStage = stage, chatPrompt = "make a todo app", buildStartedAtMs = 0L)

    @Test fun planning_shows_thinking_and_cancel() {
        show(base(ChatStage.Planning))
        rule.onNodeWithText("make a todo app").assertIsDisplayed()
        rule.onNodeWithText("Thinking through your idea", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Cancel build").performClick()
        assertEquals(listOf("cancel"), calls)
    }

    @Test fun planReady_shows_plan_and_buttons() {
        show(base(ChatStage.PlanReady).copy(buildPlan = plan))
        rule.onNodeWithText("Here's my plan").assertIsDisplayed()
        rule.onNodeWithText("A tidy todo app").assertIsDisplayed()
        rule.onNodeWithText("• Add tasks").assertIsDisplayed()
        rule.onNodeWithText("Style: Dark and minimal").assertIsDisplayed()
        rule.onNodeWithText("Build this").performClick()
        rule.onNodeWithText("Edit prompt").performClick()
        assertEquals(listOf("confirm", "edit"), calls)
    }

    @Test fun plan_buttons_hidden_once_building() {
        show(base(ChatStage.Building).copy(buildPlan = plan, buildPhase = "Generate"))
        rule.onNodeWithText("Here's my plan").assertIsDisplayed()
        rule.onNodeWithText("Build this").assertDoesNotExist()
        rule.onNodeWithText("Edit prompt").assertDoesNotExist()
    }

    @Test fun building_shows_all_phases_and_log() {
        show(
            base(ChatStage.Building).copy(
                buildPhase = "Validate", progressPercent = 40.0, buildDetail = "Linting files",
                buildEvents = listOf(ProgressEvent(message = "Writing components"), ProgressEvent(message = "Running validator"))
            )
        )
        rule.onNodeWithText("Building your app").assertIsDisplayed()
        listOf("Generate", "Validate", "Fix", "Polish", "Verify").forEach { rule.onNodeWithText(it).assertIsDisplayed() }
        rule.onNodeWithText("Writing components").assertIsDisplayed()
        rule.onNodeWithText("Running validator").assertIsDisplayed()
        rule.onNodeWithText("Linting files", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Cancel build").assertIsDisplayed()
        rule.onNodeWithText("Your app is ready").assertDoesNotExist()
    }

    @Test fun building_upsell_visible_only_when_requested() {
        show(base(ChatStage.Building), showUpsell = true)
        rule.onNodeWithText("This is your last free build").assertIsDisplayed()
        rule.onNodeWithText("Upgrade to Pro").performClick()
        assertEquals(listOf("upgrade"), calls)
    }

    @Test fun building_no_upsell_by_default() {
        show(base(ChatStage.Building))
        rule.onNodeWithText("This is your last free build").assertDoesNotExist()
    }

    private fun ready(previewUrl: String? = "https://x.test/p", dir: File? = null) =
        base(ChatStage.Ready).copy(previewUrl = previewUrl, bundleDir = dir, buildFinishedAtMs = 65_000L)

    @Test fun ready_with_preview_shows_actions() {
        show(ready())
        rule.onNodeWithText("Build complete").assertIsDisplayed()
        rule.onNodeWithText("Your app is ready").assertIsDisplayed()
        rule.onNodeWithText("1:05").assertIsDisplayed()
        rule.onNodeWithText("Open live preview").assertIsDisplayed().performClick()
        rule.onNodeWithText("Publish").assertIsEnabled().performClick()
        rule.onNodeWithText("Tweak").assertIsDisplayed()
        rule.onNodeWithText("Saved").assertIsNotEnabled()
        rule.onNodeWithText("Start a new app").performClick()
        assertEquals(listOf("preview", "publish", "new"), calls)
    }

    @Test fun ready_without_preview_hides_open_and_disables_publish() {
        show(ready(previewUrl = null))
        rule.onNodeWithText("Open live preview").assertDoesNotExist()
        rule.onNodeWithText("Publish").assertIsNotEnabled()
        rule.onNodeWithText("Saved to My Projects.").assertIsDisplayed()
    }

    @Test fun ready_shows_published_url() {
        show(ready().copy(deployedUrl = "https://my.vibebuild.app"))
        rule.onNodeWithText("Published: https://my.vibebuild.app").assertIsDisplayed()
    }

    @Test fun ready_tweak_composer_sends_text() {
        show(ready())
        rule.onNodeWithText("Describe a change...").performTextInput("make it blue")
        rule.onNodeWithContentDescription("Send tweak").assertIsEnabled().performClick()
        assertEquals(listOf("tweak:make it blue"), calls)
    }

    @Test fun ready_send_disabled_when_empty() {
        show(ready())
        rule.onNodeWithContentDescription("Send tweak").assertIsNotEnabled()
    }

    @Test fun tweak_turns_render_states() {
        show(
            ready().copy(
                tweakTurns = listOf(TweakTurn("make it blue", true), TweakTurn("add dark mode", false), TweakTurn("more", null)),
                tweakPhase = "Patching"
            )
        )
        rule.onNodeWithText("make it blue").assertIsDisplayed()
        rule.onNodeWithText("Done. Updated the preview (v2).").assertIsDisplayed()
        rule.onNodeWithText("That tweak didn't go through.").assertIsDisplayed()
        rule.onNodeWithText("Patching", substring = true).assertIsDisplayed()
    }

    @Test fun failed_shows_error_and_retry_actions() {
        show(base(ChatStage.Failed).copy(buildFailure = "Generation error"))
        rule.onNodeWithText("Build failed").assertIsDisplayed()
        rule.onNodeWithText("Generation error").assertIsDisplayed()
        rule.onNodeWithText("Edit & retry").performClick()
        rule.onNodeWithText("New app").performClick()
        assertEquals(listOf("edit", "new"), calls)
    }

    @Test fun failed_without_message_uses_fallback() {
        show(base(ChatStage.Failed))
        rule.onNodeWithText("Something went wrong.").assertIsDisplayed()
    }
}
