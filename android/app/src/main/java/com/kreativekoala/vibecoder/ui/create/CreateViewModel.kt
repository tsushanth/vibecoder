package com.kreativekoala.vibecoder.ui.create

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import com.kreativekoala.vibecoder.MainActivity
import com.kreativekoala.vibecoder.ui.paywall.GenerationLimit
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.BuildPlan
import com.kreativekoala.vibecoder.data.model.ProgressEvent
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.data.model.SseEvent
import com.kreativekoala.vibecoder.data.model.Suggestion
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.data.local.UserPreferences
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.DeployRepository
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.data.repository.SubscriptionRepository
import com.kreativekoala.vibecoder.util.NotificationHelper
import kotlinx.coroutines.flow.first
import com.kreativekoala.vibecoder.util.ZipExtractor
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import javax.inject.Inject

enum class ChatStage { Idle, Planning, PlanReady, Building, Ready, Failed }

/** A follow-up tweak in the chat thread. `done` = null while running, true/false when finished. */
data class TweakTurn(val text: String, val done: Boolean? = null)

data class CreateUiState(
    val isGenerating: Boolean = false,
    val buildPhase: String = "",
    val buildDetail: String = "",
    val progressPercent: Double = 0.0,
    val simulatedProgress: Double = 0.0,
    val notifyEnabled: Boolean = false,
    val estimatedSecondsRemaining: Int = 0,
    val errorMessage: String? = null,
    val bundleDir: File? = null,
    val bundleBase64: String? = null,
    val showPreview: Boolean = false,
    val isSaving: Boolean = false,
    val savedProjectId: String? = null,
    val suggestions: List<Suggestion> = emptyList(),
    val prompt: String = "",
    val referenceImageBase64: String? = null,
    val isDeploying: Boolean = false,
    val deployedUrl: String? = null,
    val showDeployDialog: Boolean = false,
    val isLoadingSuggestions: Boolean = false,
    val isTweaking: Boolean = false,
    val tweakPhase: String = "",
    val feedbackSent: String? = null,
    val versionNumber: Int = 0,
    val showRatingPrompt: Boolean = false,
    // ---- Chat build thread (state lives here so it survives tab switches) ----
    val chatStage: ChatStage = ChatStage.Idle,
    val chatPrompt: String = "",
    val chatImageBase64: String? = null,
    val buildPlan: BuildPlan? = null,
    val buildProjectId: String? = null,
    val buildStartedAtMs: Long = 0L,
    val buildFinishedAtMs: Long? = null,
    val buildEvents: List<ProgressEvent> = emptyList(),
    val buildFailure: String? = null,
    val previewUrl: String? = null,
    val tweakTurns: List<TweakTurn> = emptyList(),
    val showSystemBusyDialog: Boolean = false,
    /** True when the user attempted generation past the free limit. Triggers a
     * non-dismissible paywall inside CreateScreen until they subscribe. */
    val showHardPaywall: Boolean = false,
    /** Curated starter templates bundled in the app — same 30 lessons the
     *  iOS catalog ships. Tapping one fills `prompt` with its description. */
    val templates: List<com.kreativekoala.vibecoder.data.model.Template> = emptyList(),
)

@HiltViewModel
class CreateViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val projectRepository: ProjectRepository,
    private val authRepository: AuthRepository,
    private val subscriptionRepository: SubscriptionRepository,
    private val deployRepository: DeployRepository,
    private val userPreferences: UserPreferences,
    private val templateRepository: com.kreativekoala.vibecoder.data.repository.TemplateRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        CreateUiState(templates = templateRepository.all())
    )
    val uiState: StateFlow<CreateUiState> = _uiState.asStateFlow()

    /** Fills the prompt with the template's description and lets the user
     *  tweak before tapping Generate. We deliberately don't auto-start
     *  generation — the template is an idea seed, not a one-tap action. */
    fun selectTemplate(template: com.kreativekoala.vibecoder.data.model.Template) {
        _uiState.update { it.copy(prompt = template.description) }
    }

    private var generationJob: Job? = null

    private val allSuggestions = listOf(
        Suggestion("Portfolio Site", "Build a personal portfolio website with a dark theme, animated hero section, project gallery with hover effects, skills section, and a working contact form"),
        Suggestion("Task Manager", "Build a Kanban-style task manager with drag and drop columns (To Do, In Progress, Done), ability to add/edit/delete tasks, priority labels, and local storage persistence"),
        Suggestion("E-Commerce Store", "Build a modern e-commerce product page with image gallery, size selector, add to cart button, customer reviews section, and a responsive mobile layout"),
        Suggestion("Analytics Dashboard", "Build an analytics dashboard with sidebar navigation, chart cards showing revenue/users/orders metrics, a data table with sorting, and a dark professional theme"),
        Suggestion("Restaurant Menu", "Build a restaurant website with a hero image, interactive menu with categories and filtering, reservation form, photo gallery, and Google Maps embed placeholder"),
        Suggestion("Quiz Game", "Build an interactive quiz game with multiple choice questions, score tracking, timer, progress bar, results screen with share button, and colorful animations"),
        Suggestion("Recipe Finder", "Build a recipe search app with ingredient-based filtering, step-by-step cooking instructions, save favorites, and a warm kitchen-themed design"),
        Suggestion("Weather Dashboard", "Build a weather app that shows current conditions and 5-day forecast with temperature, humidity, wind speed, weather icons, and a clean card layout"),
        Suggestion("Habit Tracker", "Build a habit tracking app where each habit grows a virtual plant based on consistency, with streak counters, weekly progress charts, and a garden aesthetic"),
        Suggestion("Mood Journal", "Build a mood tracking journal where users log daily emotions with color-coded entries, write reflections, view mood trends over time, and export their history"),
        Suggestion("Pomodoro Timer", "Build a Pomodoro productivity timer with customizable work/break intervals, session counter, task list integration, ambient sounds, and a minimal focused design"),
        Suggestion("Budget Planner", "Build a personal budget planner with income and expense tracking, category breakdowns with pie charts, monthly summaries, savings goals, and a clean modern UI"),
        Suggestion("Flashcard App", "Build a spaced repetition flashcard app with deck creation, flip animations, difficulty rating, progress tracking, and a study streak counter"),
        Suggestion("Music Player", "Build a music player UI with album art display, playback controls, playlist management, equalizer visualization, and a sleek dark gradient theme"),
        Suggestion("Travel Planner", "Build a trip planning app with destination search, itinerary builder with drag-and-drop days, packing checklist, budget tracker, and a map-themed design"),
        Suggestion("Fitness Logger", "Build a workout tracker with exercise library, set/rep logging, progress charts, personal records, rest timer, and an energetic sports-themed design"),
        Suggestion("Landing Page", "Build a SaaS landing page with animated hero, feature cards, pricing table, testimonial carousel, FAQ accordion, and a call-to-action with email signup"),
        Suggestion("Chat Interface", "Build a real-time chat interface with message bubbles, typing indicators, emoji picker, file attachment previews, and a clean WhatsApp-inspired design"),
        Suggestion("Notes App", "Build a markdown notes app with sidebar navigation, rich text editing, tag-based organization, search functionality, and a Notion-inspired minimal design"),
        Suggestion("Photo Gallery", "Build a photo gallery with masonry grid layout, lightbox viewer, album organization, drag-and-drop upload, and smooth transition animations"),
        Suggestion("Booking System", "Build a service booking app with calendar date picker, time slot selection, service menu, booking confirmation, and a professional clean design"),
        Suggestion("Social Feed", "Build a social media feed with post cards, like/comment interactions, user avatars, infinite scroll, stories bar at top, and a modern Instagram-inspired layout"),
        Suggestion("Code Playground", "Build a live code editor with HTML/CSS/JS tabs, real-time preview panel, syntax highlighting, code sharing, and a VS Code-inspired dark theme"),
        Suggestion("Movie Browser", "Build a movie discovery app with trending carousel, genre filtering, movie detail cards with ratings, watchlist feature, and a Netflix-inspired dark theme"),
        Suggestion("Resume Builder", "Build a resume builder with form sections for experience, education, and skills, live preview, multiple template choices, and PDF-style export view"),
        Suggestion("Countdown Timer", "Build an event countdown app with multiple countdowns, custom background images per event, share functionality, and animated flip-clock style numbers"),
        Suggestion("Drawing Canvas", "Build a drawing app with brush tools, color picker, undo/redo, layer support, canvas resize, and the ability to save artwork as PNG"),
        Suggestion("Crypto Tracker", "Build a cryptocurrency dashboard with live price cards, sparkline charts, portfolio tracker, watchlist, price alerts setup, and a futuristic dark theme"),
        Suggestion("Survey Builder", "Build a form/survey builder with drag-and-drop question types, preview mode, response summary, and a clean Typeform-inspired design"),
        Suggestion("Podcast Player", "Build a podcast player with episode list, playback speed controls, chapter markers, queue management, and a minimal audio-focused design"),
        Suggestion("Grocery List", "Build a smart grocery list app with category grouping, quantity adjusters, check-off items, frequently bought suggestions, and a fresh produce-themed design"),
        Suggestion("Color Palette", "Build a color palette generator with random palette creation, color harmony rules, copy hex codes, save palettes, and smooth gradient previews"),
        Suggestion("Blog Platform", "Build a blog with article list, reading time estimates, tag filtering, dark/light mode toggle, and a clean Medium-inspired typography-focused design"),
        Suggestion("Meditation App", "Build a meditation timer with guided breathing animation, ambient nature sounds, session history, streak tracking, and a calming zen-inspired design"),
        Suggestion("Typing Speed", "Build a typing speed test with random text passages, live WPM counter, accuracy tracking, high score board, and a retro terminal-style design"),
        Suggestion("Event Board", "Build a community event board with event cards, date filtering, category tags, RSVP buttons, map location previews, and a vibrant poster-style design"),
        Suggestion("Invoice Maker", "Build an invoice generator with client details form, line item table, tax calculations, PDF preview, and a professional business-themed design"),
        Suggestion("Reading List", "Build a book tracking app with reading status, star ratings, notes per book, reading stats, and a warm library-themed design"),
        Suggestion("Password Gen", "Build a password generator with length slider, character type toggles, strength meter, copy button, password history, and a security-themed dark design"),
        Suggestion("Pet Dashboard", "Build a pet care tracker with feeding schedules, vet appointment calendar, medication reminders, photo gallery per pet, and a playful paw-print themed design"),
        Suggestion("Kanban Board", "Build a project management board with customizable columns, task cards with labels and due dates, drag and drop, member avatars, and a Trello-inspired design"),
        Suggestion("Language Cards", "Build a language learning flashcard app with vocabulary decks, pronunciation guide, spaced repetition, daily goals, and a colorful educational design"),
        Suggestion("Meal Planner", "Build a weekly meal planning app with drag-and-drop recipe slots, auto-generated grocery lists, nutritional summaries, and a fresh food-photography inspired design"),
        Suggestion("Pixel Art Editor", "Build a pixel art editor with grid canvas, color palette, brush and fill tools, animation frames, export as sprite sheet, and a retro 8-bit themed interface"),
        Suggestion("Expense Splitter", "Build a bill splitting app for groups with itemized expenses, equal or custom splits, running balances, settle up tracking, and a friendly social design"),
        Suggestion("Mood Playlist", "Build a mood-based playlist maker where users pick emotions from a wheel, get song suggestions with album art, create shareable playlists, and a Spotify-inspired dark UI"),
        Suggestion("Daily Standup", "Build a daily standup tracker where team members log yesterday, today, and blockers, with history view, team overview, and a clean Slack-inspired design"),
        Suggestion("Emoji Kitchen", "Build a fun emoji mixer app where users combine two emojis to create mashup designs, browse combinations, share results, and a playful colorful interface"),
        Suggestion("Plant Identifier", "Build a plant care app with a plant library, watering schedule reminders, growth photo journal, care tips, and a lush botanical green-themed design"),
        Suggestion("Debate Timer", "Build a debate/speech timer with configurable rounds, speaker tracking, bell sounds, score cards, and a professional podium-themed dark design")
    )

    private fun getRandomSuggestions(count: Int = 6): List<Suggestion> {
        return allSuggestions.shuffled().take(count)
    }

    // Must be declared before init: init calls restoreChatSnapshot(), and Kotlin initializes
    // properties in declaration order, so a later declaration would still be null there.
    private val snapshotPrefs = appContext.getSharedPreferences("chat_snapshot", Context.MODE_PRIVATE)
    private var ratingArmed = false
    private var previewOpened = false
    private var planJob: Job? = null
    private var progressJob: Job? = null

    init {
        loadSuggestions()
        checkPendingGeneration()
        restoreChatSnapshot()
    }

    // ---- Chat snapshot (survives process death / activity recreation) ----

    /** Building snapshots are recovered by [checkPendingGeneration]; Ready snapshots are reloaded here. */
    private fun saveChatSnapshot(stage: ChatStage, projectId: String?) {
        val s = _uiState.value
        snapshotPrefs.edit()
            .putString("stage", stage.name)
            .putString("userId", authRepository.currentUser?.uid)
            .putString("projectId", projectId)
            .putString("prompt", s.chatPrompt)
            .putString("planSummary", s.buildPlan?.summary)
            .apply()
    }

    private fun clearChatSnapshot() {
        snapshotPrefs.edit().clear().apply()
    }

    private fun restoreChatSnapshot() {
        if (snapshotPrefs.getString("stage", null) != ChatStage.Ready.name) return
        val projectId = snapshotPrefs.getString("projectId", null)
        val userId = authRepository.currentUser?.uid
        if (projectId == null || userId == null || snapshotPrefs.getString("userId", null) != userId) {
            clearChatSnapshot()
            return
        }
        val prompt = snapshotPrefs.getString("prompt", "") ?: ""
        val summary = snapshotPrefs.getString("planSummary", null)
        viewModelScope.launch {
            val project = try {
                projectRepository.getProject(projectId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: retrofit2.HttpException) {
                if (e.code() == 404) clearChatSnapshot()
                return@launch
            } catch (e: Exception) {
                Log.w("Create", "Restoring chat failed: ${e.message}")
                return@launch // transient (offline) — keep snapshot, stay on the composer
            }
            if (project == null) { clearChatSnapshot(); return@launch }
            // Something else (new build, pending recovery) took over while we were loading.
            if (_uiState.value.chatStage != ChatStage.Idle) return@launch
            val bundle = project.bundle?.takeIf { it.isNotBlank() }
            val dir = bundle?.let {
                try {
                    withContext(Dispatchers.IO) { ZipExtractor.extractBundle(base64Bundle = it, cacheDir = appContext.cacheDir) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w("Create", "Bundle extract failed: ${e.message}")
                    null
                }
            }
            _uiState.update {
                if (it.chatStage != ChatStage.Idle) it else it.copy(
                    chatStage = ChatStage.Ready,
                    chatPrompt = prompt,
                    buildPlan = summary?.let { s -> BuildPlan(summary = s) },
                    buildProjectId = projectId,
                    savedProjectId = projectId,
                    bundleDir = dir,
                    bundleBase64 = bundle,
                    previewUrl = project.previewUrl,
                    progressPercent = 100.0,
                    buildPhase = "Complete",
                    buildFinishedAtMs = System.currentTimeMillis()
                )
            }
        }
    }

    // Rating prompt is armed when a build finishes but only shown once the user has
    // looked at the result (opened + closed the preview) or moved on (tweak / new chat).

    private fun maybeShowRatingPrompt() {
        if (!ratingArmed || _uiState.value.showPreview) return
        ratingArmed = false
        viewModelScope.launch {
            if (!userPreferences.hasShownRatingPrompt.first()) {
                userPreferences.markRatingPromptShown()
                _uiState.update { it.copy(showRatingPrompt = true) }
            }
        }
    }

    private fun checkPendingGeneration() {
        viewModelScope.launch {
            val pendingPrompt = userPreferences.pendingGenerationPrompt.first()
            val pendingTime = userPreferences.pendingGenerationTime.first()?.toLongOrNull()

            if (pendingPrompt != null && pendingTime != null) {
                val elapsedMinutes = (System.currentTimeMillis() - pendingTime) / 60_000
                if (elapsedMinutes < 10) {
                    // Generation was in progress less than 10 min ago — poll for result
                    val userId = authRepository.currentUser?.uid ?: return@launch
                    Log.d("Create", "Found pending generation: \"${pendingPrompt.take(50)}\" (${elapsedMinutes}m ago)")
                    _uiState.update {
                        it.copy(
                            chatStage = ChatStage.Building,
                            chatPrompt = pendingPrompt,
                            buildStartedAtMs = pendingTime,
                            buildPhase = "Checking for your app...",
                            buildDetail = "Your app may still be building",
                            progressPercent = 0.0
                        )
                    }
                    pollForCompletedProject(userId)
                } else {
                    // Too old — clear it
                    userPreferences.clearPendingGeneration()
                }
            }
        }
    }

    private fun loadSuggestions() {
        // Show random 6 from the full pool immediately
        _uiState.update { it.copy(suggestions = getRandomSuggestions()) }

        viewModelScope.launch {
            try {
                val suggestions = projectRepository.getSuggestions()
                if (suggestions.isNotEmpty()) {
                    _uiState.update { it.copy(suggestions = suggestions) }
                }
            } catch (e: Exception) {
                Log.e("Create", "Failed to load suggestions: ${e.message}")
            }
        }
    }

    fun suggestNewIdeas() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingSuggestions = true) }
            try {
                val suggestions = projectRepository.suggestNewIdeas()
                if (suggestions.isNotEmpty()) {
                    _uiState.update { it.copy(suggestions = suggestions) }
                } else {
                    _uiState.update { it.copy(suggestions = getRandomSuggestions()) }
                }
            } catch (e: Exception) {
                Log.e("Create", "suggestNewIdeas failed: ${e.message}", e)
                _uiState.update { it.copy(suggestions = getRandomSuggestions()) }
            } finally {
                _uiState.update { it.copy(isLoadingSuggestions = false) }
            }
        }
    }

    fun updatePrompt(prompt: String) {
        _uiState.update { it.copy(prompt = prompt) }
    }

    fun setReferenceImage(base64: String?) {
        _uiState.update { it.copy(referenceImageBase64 = base64) }
    }

    /**
     * Validates prompt for code injection, malicious content, and non-app requests.
     * Returns an error message if invalid, null if OK.
     */
    private fun validatePrompt(prompt: String): String? {
        val lower = prompt.lowercase()

        // Block code injection attempts (Python, JS, shell imports/commands)
        val codePatterns = listOf(
            "import os", "import subprocess", "import asyncio", "import sys",
            "require(", "eval(", "exec(", "system(",
            "subprocess.", "os.system", "os.popen",
            "child_process", "puppeteer", "selenium",
            "websocket.server", "websockets.connect",
            "#!/", "bash -c", "curl ", "wget ",
            "rm -rf", "chmod ", "chown ",
            "def __", "if __name__",
            "<script>", "javascript:", "onerror=",
            "document.cookie", "window.location"
        )
        if (codePatterns.any { lower.contains(it) }) {
            return "Your prompt looks like code, not an app description. Please describe the app you'd like to build in plain language."
        }

        // Block prompts that are mostly code (high special character ratio)
        val codeChars = prompt.count { it in "{}();=<>[]" }
        if (codeChars > prompt.length * 0.1 && prompt.length > 50) {
            return "Please describe your app idea in plain language instead of code."
        }

        // Block URLs (except for design inspiration references)
        val urlPattern = Regex("https?://\\S+", RegexOption.IGNORE_CASE)
        if (urlPattern.containsMatchIn(prompt)) {
            return "Please describe your app idea in your own words instead of pasting URLs."
        }

        return null
    }

    fun startGeneration() {
        val currentState = _uiState.value
        val prompt = currentState.prompt.trim()
        if (prompt.isEmpty()) return

        // Validate prompt for malicious content
        val validationError = validatePrompt(prompt)
        if (validationError != null) {
            _uiState.update { it.copy(errorMessage = validationError) }
            return
        }

        // Hard paywall gate — check at the *action*, not just app launch. Previously
        // the limit was only checked when AppContentWithPaywallGate first mounted,
        // so a user could keep building indefinitely once their session started.
        if (GenerationLimit.isOverLimit(MainActivity.isPremiumUser(appContext), MainActivity.getGenerationCount(appContext))) {
            _uiState.update { it.copy(showHardPaywall = true) }
            return
        }

        val userId = authRepository.currentUser?.uid ?: run {
            _uiState.update { it.copy(errorMessage = "Please sign in to generate projects") }
            return
        }
        val userName = authRepository.currentUser?.displayName ?: "VibeBuild User"

        val image = currentState.referenceImageBase64
        val stage = currentState.chatStage
        if (stage == ChatStage.Planning || stage == ChatStage.PlanReady || stage == ChatStage.Building) return

        finishing = false
        _uiState.update {
            it.copy(
                chatStage = ChatStage.Planning,
                chatPrompt = prompt,
                chatImageBase64 = image,
                prompt = "",
                referenceImageBase64 = null,
                buildPlan = null,
                buildProjectId = null,
                buildStartedAtMs = System.currentTimeMillis(),
                buildFinishedAtMs = null,
                buildEvents = emptyList(),
                buildFailure = null,
                buildPhase = "",
                buildDetail = "",
                progressPercent = 0.0,
                showPreview = false,
                bundleDir = null,
                bundleBase64 = null,
                savedProjectId = null,
                previewUrl = null,
                tweakTurns = emptyList(),
                versionNumber = 0,
                feedbackSent = null,
                deployedUrl = null
            )
        }

        // Optional plan step: if the endpoint is missing/slow/fails, go straight to building.
        planJob = viewModelScope.launch {
            val plan = withTimeoutOrNull(10_000) { projectRepository.plan(prompt) }
            if (_uiState.value.chatStage != ChatStage.Planning) return@launch
            if (plan != null) {
                _uiState.update { it.copy(chatStage = ChatStage.PlanReady, buildPlan = plan) }
            } else {
                beginBuild()
            }
        }
    }

    fun confirmPlan() {
        if (_uiState.value.chatStage != ChatStage.PlanReady) return
        beginBuild()
    }

    /** Back to the idle composer with the original prompt restored for editing. */
    fun editPrompt() {
        cancelJobs()
        _uiState.update {
            it.copy(
                chatStage = ChatStage.Idle,
                prompt = it.chatPrompt,
                referenceImageBase64 = it.chatImageBase64,
                buildPlan = null,
                buildFailure = null
            )
        }
    }

    private fun beginBuild() {
        val s = _uiState.value
        val prompt = s.chatPrompt
        val image = s.chatImageBase64
        val userId = authRepository.currentUser?.uid ?: run {
            _uiState.update { it.copy(chatStage = ChatStage.Idle, prompt = prompt, errorMessage = "Please sign in to generate projects") }
            return
        }
        val userName = authRepository.currentUser?.displayName ?: "VibeBuild User"

        finishing = false
        ratingArmed = false
        previewOpened = false
        saveChatSnapshot(ChatStage.Building, null)
        _uiState.update {
            it.copy(
                chatStage = ChatStage.Building,
                buildStartedAtMs = System.currentTimeMillis(),
                buildPhase = "Generate",
                buildDetail = "Starting your build...",
                progressPercent = 0.0
            )
        }

        generationJob = viewModelScope.launch {
            // Persist generation state so we can recover if app is killed
            userPreferences.savePendingGeneration(prompt)
            // Track generation count for paywall
            MainActivity.incrementGenerationCount(appContext)

            var queuedProjectId: String? = null
            try {
                projectRepository.generate(
                    prompt = prompt,
                    userId = userId,
                    userName = userName,
                    referenceImage = image
                ).collect { event ->
                    when (event) {
                        is SseEvent.Queued -> {
                            queuedProjectId = event.projectId
                            _uiState.update { it.copy(buildProjectId = event.projectId) }
                            Log.d("Create", "Build queued: projectId=${event.projectId}")
                            startProgressPolling(event.projectId)
                        }
                        is SseEvent.Status -> applySseStatus(event)
                        is SseEvent.Result -> {
                            val pid = event.projectId ?: queuedProjectId
                            if (pid != null) {
                                finishReady(pid, event.bundle, event.previewUrl)
                            }
                        }
                        is SseEvent.Error -> {
                            Log.w("Create", "SSE error during generation: ${event.error}")
                            if (event.systemBusy) {
                                userPreferences.clearPendingGeneration()
                                cancelJobs()
                                _uiState.update {
                                    it.copy(
                                        chatStage = ChatStage.Idle,
                                        prompt = it.chatPrompt,
                                        referenceImageBase64 = it.chatImageBase64,
                                        showSystemBusyDialog = true
                                    )
                                }
                            } else if (queuedProjectId == null) {
                                failBuild(event.error)
                            }
                            // else: build may still be running; the progress poller decides
                        }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("Create", "SSE stream dropped: ${e.message}")
            }
            // Stream closed. Without a projectId we can never learn the outcome.
            if (queuedProjectId == null && _uiState.value.chatStage == ChatStage.Building) {
                failBuild("Couldn't start your build. Please try again.")
            }
        }
    }

    @Volatile private var finishing = false

    private fun cancelJobs() {
        planJob?.cancel()
        generationJob?.cancel()
        progressJob?.cancel()
    }

    private fun applySseStatus(event: SseEvent.Status) {
        _uiState.update {
            val msg = event.message.ifEmpty { event.detail }
            val events = if (msg.isNotEmpty() && it.buildEvents.lastOrNull()?.message != msg)
                it.buildEvents + ProgressEvent(phase = event.phase, message = msg) else it.buildEvents
            it.copy(
                buildPhase = event.phase.ifEmpty { it.buildPhase },
                buildDetail = event.detail.ifEmpty { event.message },
                progressPercent = maxOf(it.progressPercent, event.resolvedProgress()),
                buildEvents = events
            )
        }
    }

    /**
     * Polls GET api/projects/{id}/progress every ~2s. If the endpoint 404s twice, degrades to
     * checking project status every ~10s (the old behavior).
     */
    private fun startProgressPolling(projectId: String) {
        if (progressJob?.isActive == true) return
        progressJob = viewModelScope.launch {
            val started = System.currentTimeMillis()
            var unsupported = 0
            var tick = 0
            while (_uiState.value.chatStage == ChatStage.Building) {
                if (System.currentTimeMillis() - started > 12 * 60_000L) {
                    failBuild("Your app may still be building. Check My Projects in a minute.")
                    return@launch
                }
                delay(2_000)
                tick++
                if (_uiState.value.chatStage != ChatStage.Building) return@launch
                try {
                    val p = if (unsupported < 2) {
                        projectRepository.getProgress(projectId).also { if (it == null) unsupported++ }
                    } else null
                    if (p != null) {
                        _uiState.update {
                            it.copy(
                                buildPhase = p.phase.ifEmpty { it.buildPhase },
                                buildDetail = p.detail.ifEmpty { it.buildDetail },
                                progressPercent = maxOf(it.progressPercent, p.percent),
                                buildEvents = p.events?.takeIf { e -> e.isNotEmpty() } ?: it.buildEvents
                            )
                        }
                        when (p.status.lowercase()) {
                            "ready" -> { finishReady(projectId, null, null); return@launch }
                            "failed" -> { failBuild(p.error ?: "The build failed. Please try again."); return@launch }
                        }
                    } else if (tick % 5 == 0) {
                        val project = projectRepository.getProject(projectId)
                        when (project?.status?.lowercase()) {
                            "ready" -> { finishReady(projectId, null, null); return@launch }
                            "failed" -> { failBuild("The build failed. Please try again."); return@launch }
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.d("Create", "Progress poll failed: ${e.message}")
                }
            }
        }
    }

    /** Recovery path: no projectId known, so find the project by prompt, then track it. */
    private fun pollForCompletedProject(userId: String) {
        progressJob = viewModelScope.launch {
            val prompt = _uiState.value.chatPrompt
            for (attempt in 1..30) {
                delay(10_000)
                if (_uiState.value.chatStage != ChatStage.Building) return@launch
                _uiState.update { it.copy(buildDetail = "Checking for your project... (${attempt * 10}s)") }
                try {
                    val projects = projectRepository.getMyProjects(userId)
                    val match = projects.firstOrNull { p ->
                        p.description == prompt || p.title.lowercase().startsWith(
                            prompt.trim().split("\\s+".toRegex()).take(4).joinToString(" ").lowercase().take(30)
                        )
                    }
                    if (match != null) {
                        _uiState.update { it.copy(buildProjectId = match.id) }
                        if (match.status?.lowercase() == "ready") {
                            finishReady(match.id, null, null)
                        } else {
                            progressJob = null
                            startProgressPolling(match.id)
                        }
                        return@launch
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.d("Create", "Poll attempt $attempt failed: ${e.message}")
                }
            }
            failBuild("Your app may still be building. Check 'My Projects' in a minute.")
        }
    }

    private fun failBuild(message: String) {
        clearChatSnapshot()
        viewModelScope.launch { userPreferences.clearPendingGeneration() }
        _uiState.update {
            if (it.chatStage == ChatStage.Ready) it
            else it.copy(chatStage = ChatStage.Failed, buildFailure = message, buildFinishedAtMs = System.currentTimeMillis())
        }
    }

    private suspend fun finishReady(projectId: String, inlineBundle: String?, inlinePreview: String?) {
        if (finishing) return
        finishing = true
        var bundle = inlineBundle?.takeIf { it.isNotBlank() }
        var previewUrl = inlinePreview
        if (bundle == null) {
            try {
                val p = projectRepository.getProject(projectId)
                bundle = p?.bundle?.takeIf { it.isNotBlank() }
                previewUrl = previewUrl ?: p?.previewUrl
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("Create", "Fetching finished project failed: ${e.message}")
            }
        }
        val dir = bundle?.let {
            try {
                withContext(Dispatchers.IO) { ZipExtractor.extractBundle(base64Bundle = it, cacheDir = appContext.cacheDir) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("Create", "Bundle extract failed: ${e.message}")
                null
            }
        }
        userPreferences.clearPendingGeneration()
        NotificationHelper.showGenerationComplete(appContext)
        _uiState.update {
            it.copy(
                chatStage = ChatStage.Ready,
                buildProjectId = projectId,
                savedProjectId = projectId,   // server auto-saves builds
                bundleDir = dir,
                bundleBase64 = bundle,
                previewUrl = previewUrl,
                progressPercent = 100.0,
                buildPhase = "Complete",
                buildFinishedAtMs = System.currentTimeMillis()
            )
        }
        saveChatSnapshot(ChatStage.Ready, projectId)
        // Don't pop the rating dialog over the completion card; arm it for later.
        if (!userPreferences.hasShownRatingPrompt.first()) {
            ratingArmed = true
            previewOpened = false
        }
    }

    /** Leave the finished/failed thread and return to a blank composer. */
    fun newChat() {
        cancelJobs()
        finishing = false
        clearChatSnapshot()
        _uiState.update {
            it.copy(
                chatStage = ChatStage.Idle, chatPrompt = "", chatImageBase64 = null, buildPlan = null,
                buildProjectId = null, buildEvents = emptyList(), buildFailure = null, buildPhase = "",
                buildDetail = "", progressPercent = 0.0, previewUrl = null, tweakTurns = emptyList(),
                showPreview = false, bundleDir = null, bundleBase64 = null, savedProjectId = null,
                deployedUrl = null, showDeployDialog = false, isTweaking = false, tweakPhase = "",
                feedbackSent = null, versionNumber = 0, buildFinishedAtMs = null
            )
        }
        maybeShowRatingPrompt()
    }

    fun openPreview() {
        previewOpened = true
        _uiState.update { it.copy(showPreview = true) }
    }

    /** Close the preview overlay but keep the chat thread intact. */
    fun closePreview() {
        _uiState.update { it.copy(showPreview = false, showDeployDialog = false) }
        if (previewOpened) maybeShowRatingPrompt()
    }

    fun openPublish() {
        previewOpened = true
        _uiState.update { it.copy(showPreview = true, showDeployDialog = true) }
    }

    /** Called after a successful purchase from the hard paywall — re-checks the
     * `is_premium` flag set by MainActivity and lets the user resume. */
    fun onPaywallPurchaseSuccess() {
        _uiState.update { it.copy(showHardPaywall = false) }
    }

    fun dismissRatingPrompt() {
        _uiState.update { it.copy(showRatingPrompt = false) }
    }

    fun cancelGeneration() {
        cancelJobs()
        clearChatSnapshot()
        viewModelScope.launch { userPreferences.clearPendingGeneration() }
        _uiState.update {
            it.copy(
                chatStage = ChatStage.Idle,
                prompt = it.chatPrompt,
                referenceImageBase64 = it.chatImageBase64,
                isGenerating = false,
                progressPercent = 0.0,
                buildPhase = "",
                buildDetail = "",
                buildEvents = emptyList(),
                buildPlan = null
            )
        }
    }

    fun saveProject() {
        val currentState = _uiState.value
        if (currentState.savedProjectId != null) return // already saved (server auto-saves builds)
        val bundleBase64 = currentState.bundleBase64 ?: return
        val userId = authRepository.currentUser?.uid ?: return
        val userName = authRepository.currentUser?.displayName ?: "VibeBuild User"

        // Auto-derive title from first 6 words of prompt (matching iOS)
        val title = currentState.prompt.trim()
            .split("\\s+".toRegex())
            .take(6)
            .joinToString(" ")
            .take(80)
            .ifBlank { appContext.getString(R.string.create_default_project_title) }

        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }

            try {
                val projectId = projectRepository.saveProject(
                    title = title,
                    description = currentState.prompt,
                    bundle = bundleBase64,
                    creatorId = userId,
                    creatorName = userName,
                    initialPrompt = currentState.prompt
                )

                _uiState.update {
                    it.copy(
                        isSaving = false,
                        savedProjectId = projectId
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isSaving = false,
                        errorMessage = appContext.getString(R.string.create_error_save_failed, e.message ?: "")
                    )
                }
            }
        }
    }

    fun dismissPreview() {
        _uiState.update {
            it.copy(
                showPreview = false,
                bundleDir = null,
                bundleBase64 = null,
                prompt = "",
                referenceImageBase64 = null,
                savedProjectId = null,
                deployedUrl = null,
                showDeployDialog = false,
                isDeploying = false,
                isTweaking = false,
                tweakPhase = "",
                feedbackSent = null,
                errorMessage = null
            )
        }
    }

    fun setNotifyEnabled(enabled: Boolean) {
        _uiState.update { it.copy(notifyEnabled = enabled) }
    }

    fun updateSimulatedProgress(progress: Double) {
        _uiState.update { it.copy(simulatedProgress = progress) }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun dismissSystemBusyDialog() {
        _uiState.update { it.copy(showSystemBusyDialog = false) }
    }

    fun tweakProject(tweakDescription: String) {
        val desc = tweakDescription.trim()
        if (desc.isEmpty()) return

        val userId = authRepository.currentUser?.uid ?: run {
            _uiState.update { it.copy(errorMessage = "Please sign in to tweak projects") }
            return
        }
        val userName = authRepository.currentUser?.displayName ?: "VibeBuild User"

        if (_uiState.value.isTweaking) return
        maybeShowRatingPrompt()
        if (_uiState.value.chatStage == ChatStage.Ready) {
            _uiState.update { it.copy(tweakTurns = it.tweakTurns + TweakTurn(desc)) }
        }

        viewModelScope.launch {
            // Auto-save if not already saved
            var projectId = _uiState.value.savedProjectId
            if (projectId == null) {
                val currentState = _uiState.value
                val bundleBase64 = currentState.bundleBase64 ?: run {
                    _uiState.update { it.copy(errorMessage = "No project to tweak") }
                    return@launch
                }
                val title = currentState.prompt.trim()
                    .split("\\s+".toRegex())
                    .take(6)
                    .joinToString(" ")
                    .take(80)
                    .ifBlank { appContext.getString(R.string.create_default_project_title) }

                try {
                    projectId = projectRepository.saveProject(
                        title = title,
                        description = currentState.prompt,
                        bundle = bundleBase64,
                        creatorId = userId,
                        creatorName = userName,
                        initialPrompt = currentState.prompt
                    )
                    _uiState.update { it.copy(savedProjectId = projectId) }
                } catch (e: Exception) {
                    _uiState.update { it.copy(errorMessage = "Failed to save before tweaking: ${e.message}") }
                    return@launch
                }
            }

            if (projectId == null) {
                _uiState.update { it.copy(errorMessage = "Failed to save project") }
                return@launch
            }

            _uiState.update { it.copy(isTweaking = true, tweakPhase = "Applying changes...") }

            try {
                projectRepository.tweak(
                    projectId = projectId,
                    userId = userId,
                    tweakDescription = desc
                ).collect { event ->
                    when (event) {
                        is SseEvent.Queued -> { /* not used for tweaks */ }
                        is SseEvent.Status -> {
                            _uiState.update {
                                it.copy(tweakPhase = event.detail.ifEmpty { event.message })
                            }
                        }
                        is SseEvent.Result -> {
                            val bundleDir = ZipExtractor.extractBundle(
                                base64Bundle = event.bundle,
                                cacheDir = appContext.cacheDir
                            )
                            _uiState.update {
                                it.copy(
                                    isTweaking = false,
                                    tweakPhase = "",
                                    tweakTurns = markLastTweak(it.tweakTurns, true),
                                    bundleDir = bundleDir,
                                    bundleBase64 = event.bundle,
                                    versionNumber = it.versionNumber + 1
                                )
                            }
                        }
                        is SseEvent.Error -> {
                            _uiState.update {
                                it.copy(isTweaking = false, tweakPhase = "", errorMessage = event.error, tweakTurns = markLastTweak(it.tweakTurns, false))
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isTweaking = false, tweakPhase = "", errorMessage = "Tweak failed: ${e.message}", tweakTurns = markLastTweak(it.tweakTurns, false))
                }
            }
        }
    }

    private fun markLastTweak(turns: List<TweakTurn>, ok: Boolean): List<TweakTurn> {
        val i = turns.indexOfLast { it.done == null }
        return if (i < 0) turns else turns.toMutableList().also { it[i] = it[i].copy(done = ok) }
    }

    fun sendFeedback(rating: String) {
        val userId = authRepository.currentUser?.uid ?: return
        val userName = authRepository.currentUser?.displayName ?: "VibeBuild User"

        viewModelScope.launch {
            // Auto-save if needed
            var projectId = _uiState.value.savedProjectId
            if (projectId == null) {
                val currentState = _uiState.value
                val bundleBase64 = currentState.bundleBase64 ?: return@launch
                val title = currentState.prompt.trim()
                    .split("\\s+".toRegex())
                    .take(6)
                    .joinToString(" ")
                    .take(80)
                    .ifBlank { appContext.getString(R.string.create_default_project_title) }

                try {
                    projectId = projectRepository.saveProject(
                        title = title,
                        description = currentState.prompt,
                        bundle = bundleBase64,
                        creatorId = userId,
                        creatorName = userName,
                        initialPrompt = currentState.prompt
                    )
                    _uiState.update { it.copy(savedProjectId = projectId) }
                } catch (_: Exception) { return@launch }
            }

            if (projectId == null) return@launch

            try {
                projectRepository.sendFeedback(projectId, userId, rating)
                _uiState.update { it.copy(feedbackSent = rating) }
            } catch (_: Exception) {}
        }
    }

    fun showDeployDialog() {
        _uiState.update { it.copy(showDeployDialog = true) }
    }

    fun dismissDeployDialog() {
        _uiState.update { it.copy(showDeployDialog = false) }
    }

    fun publishProject(subdomain: String) {
        val currentState = _uiState.value
        val userId = authRepository.currentUser?.uid ?: return
        val userName = authRepository.currentUser?.displayName ?: "VibeBuild User"

        _uiState.update { it.copy(showDeployDialog = false, isDeploying = true) }

        viewModelScope.launch {
            try {
                // Save first if not already saved
                val projectId = currentState.savedProjectId ?: run {
                    val bundleBase64 = currentState.bundleBase64 ?: throw Exception("No bundle")
                    val title = currentState.prompt.trim()
                        .split("\\s+".toRegex())
                        .take(6)
                        .joinToString(" ")
                        .take(80)
                        .ifBlank { appContext.getString(R.string.create_default_project_title) }

                    _uiState.update { it.copy(isSaving = true) }
                    val id = projectRepository.saveProject(
                        title = title,
                        description = currentState.prompt,
                        bundle = bundleBase64,
                        creatorId = userId,
                        creatorName = userName,
                        initialPrompt = currentState.prompt
                    ) ?: throw Exception("Failed to save project")
                    _uiState.update { it.copy(isSaving = false, savedProjectId = id) }
                    id
                }

                // Deploy
                val response = deployRepository.deploy(projectId, userId, subdomain)
                _uiState.update {
                    it.copy(
                        isDeploying = false,
                        deployedUrl = response.url
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isDeploying = false,
                        isSaving = false,
                        errorMessage = appContext.getString(R.string.create_error_publish_failed, e.message ?: "")
                    )
                }
            }
        }
    }
}
