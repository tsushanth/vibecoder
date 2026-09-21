package com.kreativekoala.vibecoder.ui.create

import android.content.Context
import android.content.SharedPreferences
import com.kreativekoala.vibecoder.MainActivity
import com.kreativekoala.vibecoder.data.local.UserPreferences
import com.kreativekoala.vibecoder.data.model.BuildPlan
import com.kreativekoala.vibecoder.data.model.ProjectProgress
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.data.model.SseEvent
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.AuthUser
import com.kreativekoala.vibecoder.data.repository.DeployRepository
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.data.repository.SubscriptionRepository
import com.kreativekoala.vibecoder.data.repository.TemplateRepository
import com.kreativekoala.vibecoder.util.NotificationHelper
import io.mockk.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/** Minimal in-memory SharedPreferences. */
class FakePrefs : SharedPreferences {
    val map = mutableMapOf<String, Any?>()
    override fun getAll(): MutableMap<String, *> = map
    override fun getString(k: String, d: String?) = map[k] as String? ?: d
    override fun getStringSet(k: String, d: MutableSet<String>?) = d
    override fun getInt(k: String, d: Int) = map[k] as Int? ?: d
    override fun getLong(k: String, d: Long) = map[k] as Long? ?: d
    override fun getFloat(k: String, d: Float) = map[k] as Float? ?: d
    override fun getBoolean(k: String, d: Boolean) = map[k] as Boolean? ?: d
    override fun contains(k: String) = map.containsKey(k)
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        private val pending = mutableMapOf<String, Any?>()
        private var clear = false
        override fun putString(k: String, v: String?) = apply { pending[k] = v }
        override fun putStringSet(k: String, v: MutableSet<String>?) = apply { pending[k] = v }
        override fun putInt(k: String, v: Int) = apply { pending[k] = v }
        override fun putLong(k: String, v: Long) = apply { pending[k] = v }
        override fun putFloat(k: String, v: Float) = apply { pending[k] = v }
        override fun putBoolean(k: String, v: Boolean) = apply { pending[k] = v }
        override fun remove(k: String) = apply { pending[k] = null }
        override fun clear() = apply { clear = true }
        override fun commit(): Boolean { apply(); return true }
        override fun apply() {
            if (clear) map.clear()
            pending.forEach { (k, v) -> if (v == null) map.remove(k) else map[k] = v }
        }
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class CreateViewModelTest {
    private val prefsByName = mutableMapOf<String, FakePrefs>()
    private val context = mockk<Context>(relaxed = true)
    private val projects = mockk<ProjectRepository>(relaxed = true)
    private val auth = mockk<AuthRepository>(relaxed = true)
    private val subs = mockk<SubscriptionRepository>(relaxed = true)
    private val deploy = mockk<DeployRepository>(relaxed = true)
    private val userPrefs = mockk<UserPreferences>(relaxed = true)
    private val templates = mockk<TemplateRepository>(relaxed = true)
    private val hasShownRating = MutableStateFlow(false)

    private fun prefs(name: String) = prefsByName.getOrPut(name) { FakePrefs() }
    private val snapshot get() = prefs("chat_snapshot")

    @Before fun setUp() {
        Dispatchers.setMain(StandardTestDispatcher())
        mockkObject(NotificationHelper)
        every { NotificationHelper.showGenerationComplete(any(), any(), any()) } just Runs
        every { context.getSharedPreferences(any(), any()) } answers { prefs(firstArg()) }
        every { auth.currentUser } returns AuthUser("u1", "a@b.c", "Ann", null)
        every { templates.all() } returns emptyList()
        every { userPrefs.pendingGenerationPrompt } returns flowOf(null)
        every { userPrefs.pendingGenerationTime } returns flowOf(null)
        every { userPrefs.hasShownRatingPrompt } returns hasShownRating
        coEvery { userPrefs.markRatingPromptShown() } coAnswers { hasShownRating.value = true }
        coEvery { projects.getSuggestions() } returns emptyList()
        coEvery { projects.plan(any()) } returns null
        coEvery { projects.getProject(any()) } answers {
            Project(id = firstArg(), title = "T", previewUrl = "https://preview/x", status = "ready")
        }
    }

    @After fun tearDown() {
        unmockkAll()
        Dispatchers.resetMain()
    }

    private fun vm() = CreateViewModel(context, projects, auth, subs, deploy, userPrefs, templates)

    private fun generateEmits(vararg events: SseEvent, thenHang: Boolean = false) {
        every { projects.generate(any(), any(), any(), any()) } returns flow {
            events.forEach { emit(it) }
            if (thenHang) awaitCancellation()
        }
    }

    private val plan = BuildPlan(summary = "A todo app", features = listOf("Add", "Delete"), style = "Dark")

    private fun TestScope.startBuild(vm: CreateViewModel, prompt: String = "make a todo app") {
        advanceUntilIdle()
        vm.updatePrompt(prompt)
        vm.startGeneration()
    }

    /** Drives a VM to the Ready stage via a queued+result stream. */
    private fun TestScope.readyVm(): CreateViewModel {
        generateEmits(SseEvent.Queued("p1"), SseEvent.Result(projectId = "p1", previewUrl = "https://preview/x"))
        val vm = vm()
        startBuild(vm)
        advanceUntilIdle()
        assertEquals(ChatStage.Ready, vm.uiState.value.chatStage)
        return vm
    }

    // ---------- stage transitions ----------

    @Test fun idle_to_planning_to_planReady_to_building_to_ready() = runTest {
        val gate = CompletableDeferred<BuildPlan?>()
        coEvery { projects.plan(any()) } coAnswers { gate.await() }
        generateEmits(SseEvent.Queued("p1"), SseEvent.Result(projectId = "p1", previewUrl = "https://preview/x"))
        val vm = vm()
        advanceUntilIdle()
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)

        vm.updatePrompt("make a todo app")
        vm.startGeneration()
        assertEquals(ChatStage.Planning, vm.uiState.value.chatStage)
        assertEquals("make a todo app", vm.uiState.value.chatPrompt)
        assertEquals("", vm.uiState.value.prompt)

        gate.complete(plan)
        advanceUntilIdle()
        assertEquals(ChatStage.PlanReady, vm.uiState.value.chatStage)
        assertEquals("A todo app", vm.uiState.value.buildPlan!!.summary)

        vm.confirmPlan()
        assertEquals(ChatStage.Building, vm.uiState.value.chatStage)
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals(ChatStage.Ready, s.chatStage)
        assertEquals("p1", s.savedProjectId)
        assertEquals(100.0, s.progressPercent, 0.0)
        assertEquals("https://preview/x", s.previewUrl)
        verify { NotificationHelper.showGenerationComplete(any(), any(), any()) }
        coVerify { userPrefs.clearPendingGeneration() }
    }

    @Test fun confirmPlan_ignored_unless_planReady() = runTest {
        val vm = vm(); advanceUntilIdle()
        vm.confirmPlan()
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
    }

    @Test fun editPrompt_returns_to_idle_with_prompt_restored() = runTest {
        coEvery { projects.plan(any()) } returns plan
        val vm = vm(); startBuild(vm, "my idea"); advanceUntilIdle()
        assertEquals(ChatStage.PlanReady, vm.uiState.value.chatStage)
        vm.editPrompt()
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
        assertEquals("my idea", vm.uiState.value.prompt)
        assertNull(vm.uiState.value.buildPlan)
    }

    @Test fun noPlan_goesStraightToBuilding() = runTest {
        generateEmits(SseEvent.Queued("p1"), thenHang = true)
        val vm = vm(); startBuild(vm)
        assertEquals(ChatStage.Planning, vm.uiState.value.chatStage)
        runCurrent()
        assertEquals(ChatStage.Building, vm.uiState.value.chatStage)
        assertNull(vm.uiState.value.buildPlan)
        vm.cancelGeneration()
    }

    @Test fun planTimeout_fallsBackToBuilding() = runTest {
        coEvery { projects.plan(any()) } coAnswers { delay(60_000); plan }
        generateEmits(SseEvent.Queued("p1"), thenHang = true)
        val vm = vm(); startBuild(vm)
        advanceTimeBy(9_000)
        assertEquals(ChatStage.Planning, vm.uiState.value.chatStage)
        advanceTimeBy(1_500)
        runCurrent()
        assertEquals(ChatStage.Building, vm.uiState.value.chatStage)
        assertNull(vm.uiState.value.buildPlan)
        vm.cancelGeneration()
    }

    @Test fun sse_error_before_queued_fails_build() = runTest {
        generateEmits(SseEvent.Error("boom"))
        val vm = vm(); startBuild(vm); advanceUntilIdle()
        assertEquals(ChatStage.Failed, vm.uiState.value.chatStage)
        assertEquals("boom", vm.uiState.value.buildFailure)
    }

    @Test fun stream_closes_without_projectId_fails() = runTest {
        generateEmits()
        val vm = vm(); startBuild(vm); advanceUntilIdle()
        assertEquals(ChatStage.Failed, vm.uiState.value.chatStage)
        assertNotNull(vm.uiState.value.buildFailure)
    }

    @Test fun systemBusy_returns_to_idle_with_dialog() = runTest {
        generateEmits(SseEvent.Error("busy", systemBusy = true))
        val vm = vm(); startBuild(vm, "idea"); advanceUntilIdle()
        val s = vm.uiState.value
        assertEquals(ChatStage.Idle, s.chatStage)
        assertTrue(s.showSystemBusyDialog)
        assertEquals("idea", s.prompt)
    }

    @Test fun cannotStartWhileBuilding() = runTest {
        generateEmits(SseEvent.Queued("p1"), thenHang = true)
        val vm = vm(); startBuild(vm); advanceTimeBy(10)
        vm.updatePrompt("second"); vm.startGeneration()
        verify(exactly = 1) { projects.generate(any(), any(), any(), any()) }
        vm.cancelGeneration()
    }

    @Test fun promptValidation_blocks_urls_and_code() = runTest {
        val vm = vm(); advanceUntilIdle()
        vm.updatePrompt("clone https://example.com"); vm.startGeneration()
        assertNotNull(vm.uiState.value.errorMessage)
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
        vm.clearError()
        vm.updatePrompt("rm -rf /"); vm.startGeneration()
        assertNotNull(vm.uiState.value.errorMessage)
    }

    @Test fun signedOut_cannotGenerate() = runTest {
        every { auth.currentUser } returns null
        val vm = vm(); startBuild(vm)
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
        assertEquals("Please sign in to generate projects", vm.uiState.value.errorMessage)
    }

    // ---------- progress polling ----------

    @Test fun progress_endpoint_updates_phase_then_ready() = runTest {
        generateEmits(SseEvent.Queued("p1"), thenHang = true)
        coEvery { projects.getProgress("p1") } returnsMany listOf(
            ProjectProgress(status = "building", phase = "Validate", detail = "Linting", percent = 40.0),
            ProjectProgress(status = "ready", phase = "Verify", percent = 100.0)
        )
        val vm = vm(); startBuild(vm)
        advanceTimeBy(2_100)
        assertEquals("Validate", vm.uiState.value.buildPhase)
        assertEquals(40.0, vm.uiState.value.progressPercent, 0.0)
        assertEquals(ChatStage.Building, vm.uiState.value.chatStage)
        advanceTimeBy(2_100)
        runCurrent()
        assertEquals(ChatStage.Ready, vm.uiState.value.chatStage)
        vm.newChat()
    }

    @Test fun progress_failed_status_fails_with_server_error() = runTest {
        generateEmits(SseEvent.Queued("p1"), thenHang = true)
        coEvery { projects.getProgress("p1") } returns ProjectProgress(status = "failed", error = "Generation error")
        val vm = vm(); startBuild(vm)
        advanceTimeBy(2_100); runCurrent()
        assertEquals(ChatStage.Failed, vm.uiState.value.chatStage)
        assertEquals("Generation error", vm.uiState.value.buildFailure)
        vm.newChat()
    }

    @Test fun progress_percent_never_goes_backwards() = runTest {
        generateEmits(SseEvent.Queued("p1"), SseEvent.Status(phase = "Generate", progressPercent = 60.0), thenHang = true)
        coEvery { projects.getProgress("p1") } returns ProjectProgress(status = "building", percent = 20.0)
        val vm = vm(); startBuild(vm)
        advanceTimeBy(2_100)
        assertEquals(60.0, vm.uiState.value.progressPercent, 0.0)
        vm.cancelGeneration()
    }

    @Test fun progress404_fallsBackToStatusPolling() = runTest {
        generateEmits(SseEvent.Queued("p1"), thenHang = true)
        coEvery { projects.getProgress("p1") } returns null
        val statuses = mutableListOf("building", "ready")
        coEvery { projects.getProject("p1") } answers {
            Project(id = "p1", title = "T", status = statuses.removeAt(0), previewUrl = "https://preview/x")
        }
        val vm = vm(); startBuild(vm)
        advanceTimeBy(9_900)
        assertEquals(ChatStage.Building, vm.uiState.value.chatStage)
        advanceTimeBy(200); runCurrent()     // tick 5 (10s): first status check -> building
        assertEquals(ChatStage.Building, vm.uiState.value.chatStage)
        advanceTimeBy(10_000); runCurrent()  // tick 10 (20s): ready
        assertEquals(ChatStage.Ready, vm.uiState.value.chatStage)
        // After two 404s the progress endpoint is no longer hit.
        coVerify(exactly = 2) { projects.getProgress("p1") }
        vm.newChat()
    }

    // ---------- snapshot ----------

    @Test fun snapshot_saved_when_ready_and_building() = runTest {
        val vm = readyVm()
        assertEquals("Ready", snapshot.map["stage"])
        assertEquals("p1", snapshot.map["projectId"])
        assertEquals("u1", snapshot.map["userId"])
        assertEquals("make a todo app", snapshot.map["prompt"])
        vm.newChat()
    }

    @Test fun snapshot_cleared_on_newChat_cancel_and_failure() = runTest {
        val vm = readyVm()
        vm.newChat()
        assertTrue(snapshot.map.isEmpty())

        generateEmits(SseEvent.Error("boom"))
        vm.updatePrompt("again"); vm.startGeneration(); advanceUntilIdle()
        assertEquals(ChatStage.Failed, vm.uiState.value.chatStage)
        assertTrue(snapshot.map.isEmpty())

        generateEmits(SseEvent.Queued("p2"), thenHang = true)
        vm.newChat()
        vm.updatePrompt("third"); vm.startGeneration(); advanceTimeBy(50)
        assertEquals("Building", snapshot.map["stage"])
        vm.cancelGeneration()
        assertTrue(snapshot.map.isEmpty())
    }

    private fun seedReadySnapshot(userId: String = "u1") {
        snapshot.map.putAll(mapOf(
            "stage" to "Ready", "userId" to userId, "projectId" to "p9",
            "prompt" to "old prompt", "planSummary" to "old summary"
        ))
    }

    @Test fun snapshot_restored_into_ready_state() = runTest {
        seedReadySnapshot()
        val vm = vm(); advanceUntilIdle()
        val s = vm.uiState.value
        assertEquals(ChatStage.Ready, s.chatStage)
        assertEquals("old prompt", s.chatPrompt)
        assertEquals("old summary", s.buildPlan!!.summary)
        assertEquals("p9", s.savedProjectId)
        assertEquals("https://preview/x", s.previewUrl)
    }

    @Test fun snapshot_for_other_user_is_discarded() = runTest {
        seedReadySnapshot(userId = "someone-else")
        val vm = vm(); advanceUntilIdle()
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
        assertTrue(snapshot.map.isEmpty())
    }

    @Test fun snapshot_cleared_when_project_404() = runTest {
        seedReadySnapshot()
        coEvery { projects.getProject("p9") } throws HttpException(Response.error<Any>(404, "".toResponseBody()))
        val vm = vm(); advanceUntilIdle()
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
        assertTrue(snapshot.map.isEmpty())
    }

    @Test fun snapshot_cleared_when_project_null() = runTest {
        seedReadySnapshot()
        coEvery { projects.getProject("p9") } returns null
        val vm = vm(); advanceUntilIdle()
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
        assertTrue(snapshot.map.isEmpty())
    }

    @Test fun snapshot_kept_on_transient_network_error() = runTest {
        seedReadySnapshot()
        coEvery { projects.getProject("p9") } throws IOException("offline")
        val vm = vm(); advanceUntilIdle()
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
        assertEquals("Ready", snapshot.map["stage"])
    }

    @Test fun snapshot_ignored_when_stage_not_ready() = runTest {
        snapshot.map.putAll(mapOf("stage" to "Building", "userId" to "u1", "projectId" to "p9"))
        val vm = vm(); advanceUntilIdle()
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
        coVerify(exactly = 0) { projects.getProject("p9") }
    }

    // ---------- rating prompt ----------

    @Test fun rating_not_shown_at_completion() = runTest {
        val vm = readyVm()
        assertFalse(vm.uiState.value.showRatingPrompt)
        coVerify(exactly = 0) { userPrefs.markRatingPromptShown() }
        vm.newChat()
    }

    @Test fun rating_shown_after_preview_opened_then_closed_and_only_once() = runTest {
        val vm = readyVm()
        vm.openPreview(); advanceUntilIdle()
        assertFalse(vm.uiState.value.showRatingPrompt)          // still looking at the preview
        vm.closePreview(); advanceUntilIdle()
        assertTrue(vm.uiState.value.showRatingPrompt)
        vm.dismissRatingPrompt()
        vm.openPreview(); vm.closePreview(); advanceUntilIdle()
        assertFalse(vm.uiState.value.showRatingPrompt)          // once only
        coVerify(exactly = 1) { userPrefs.markRatingPromptShown() }
    }

    @Test fun rating_not_shown_when_closing_preview_never_opened() = runTest {
        val vm = readyVm()
        vm.closePreview(); advanceUntilIdle()
        assertFalse(vm.uiState.value.showRatingPrompt)
    }

    @Test fun rating_shown_on_tweak() = runTest {
        every { projects.tweak(any(), any(), any()) } returns flowOf(SseEvent.Error("nope"))
        val vm = readyVm()
        vm.tweakProject("make it blue"); advanceUntilIdle()
        assertTrue(vm.uiState.value.showRatingPrompt)
    }

    @Test fun rating_shown_on_new_chat() = runTest {
        val vm = readyVm()
        vm.newChat(); advanceUntilIdle()
        assertTrue(vm.uiState.value.showRatingPrompt)
    }

    @Test fun rating_not_shown_when_already_shown_previously() = runTest {
        hasShownRating.value = true
        val vm = readyVm()
        vm.openPreview(); vm.closePreview(); vm.newChat(); advanceUntilIdle()
        assertFalse(vm.uiState.value.showRatingPrompt)
        coVerify(exactly = 0) { userPrefs.markRatingPromptShown() }
    }

    @Test fun rating_not_shown_by_tweak_while_preview_open() = runTest {
        every { projects.tweak(any(), any(), any()) } returns flowOf(SseEvent.Error("nope"))
        val vm = readyVm()
        vm.openPreview()
        vm.tweakProject("x"); advanceUntilIdle()
        assertFalse(vm.uiState.value.showRatingPrompt)
        vm.closePreview(); advanceUntilIdle()
        assertTrue(vm.uiState.value.showRatingPrompt)
    }

    // ---------- free generation limit ----------

    @Test fun freeLimit_blocks_at_limit_with_hard_paywall() = runTest {
        prefs("vibebuild_paywall_prefs").map["generation_count"] = MainActivity.FREE_GENERATION_LIMIT
        val vm = vm(); startBuild(vm)
        assertTrue(vm.uiState.value.showHardPaywall)
        assertEquals(ChatStage.Idle, vm.uiState.value.chatStage)
        coVerify(exactly = 0) { projects.plan(any()) }
        verify(exactly = 0) { projects.generate(any(), any(), any(), any()) }
    }

    @Test fun freeLimit_allows_below_limit_and_increments_count() = runTest {
        prefs("vibebuild_paywall_prefs").map["generation_count"] = MainActivity.FREE_GENERATION_LIMIT - 1
        generateEmits(SseEvent.Queued("p1"), SseEvent.Result(projectId = "p1"))
        val vm = vm(); startBuild(vm); advanceUntilIdle()
        assertFalse(vm.uiState.value.showHardPaywall)
        assertEquals(ChatStage.Ready, vm.uiState.value.chatStage)
        assertEquals(MainActivity.FREE_GENERATION_LIMIT, prefs("vibebuild_paywall_prefs").map["generation_count"])
    }

    @Test fun premium_bypasses_limit() = runTest {
        prefs("vibebuild_paywall_prefs").map["generation_count"] = MainActivity.FREE_GENERATION_LIMIT + 50
        prefs("vibebuild_paywall_prefs").map["is_premium"] = true
        generateEmits(SseEvent.Queued("p1"), SseEvent.Result(projectId = "p1"))
        val vm = vm(); startBuild(vm); advanceUntilIdle()
        assertFalse(vm.uiState.value.showHardPaywall)
        assertEquals(ChatStage.Ready, vm.uiState.value.chatStage)
    }

    @Test fun paywall_success_clears_hard_paywall() = runTest {
        prefs("vibebuild_paywall_prefs").map["generation_count"] = MainActivity.FREE_GENERATION_LIMIT
        val vm = vm(); startBuild(vm)
        vm.onPaywallPurchaseSuccess()
        assertFalse(vm.uiState.value.showHardPaywall)
    }
}
