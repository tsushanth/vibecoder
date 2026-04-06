package com.kreativekoala.vibecoder.ui.create

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import com.kreativekoala.vibecoder.MainActivity
import androidx.lifecycle.viewModelScope
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
import java.io.File
import javax.inject.Inject

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
    val showBuildingConfirmation: Boolean = false,
    val showSystemBusyDialog: Boolean = false
)

@HiltViewModel
class CreateViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val projectRepository: ProjectRepository,
    private val authRepository: AuthRepository,
    private val subscriptionRepository: SubscriptionRepository,
    private val deployRepository: DeployRepository,
    private val userPreferences: UserPreferences
) : ViewModel() {

    private val _uiState = MutableStateFlow(CreateUiState())
    val uiState: StateFlow<CreateUiState> = _uiState.asStateFlow()

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

    init {
        loadSuggestions()
        checkPendingGeneration()
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
                            isGenerating = true,
                            prompt = pendingPrompt,
                            buildPhase = "Checking for your app...",
                            buildDetail = "Your app may still be building",
                            progressPercent = 80.0
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

        val userId = authRepository.currentUser?.uid ?: run {
            _uiState.update { it.copy(errorMessage = "Please sign in to generate projects") }
            return
        }
        val userName = authRepository.currentUser?.displayName ?: "VibeBuild User"

        viewModelScope.launch {
            // Persist generation state so we can recover if app is killed
            userPreferences.savePendingGeneration(prompt)

            // Track generation count for paywall
            MainActivity.incrementGenerationCount(appContext)

            // Show confirmation and reset Create screen (fire-and-forget)
            _uiState.update {
                it.copy(
                    isGenerating = false,
                    prompt = "",
                    referenceImageBase64 = null,
                    showPreview = false,
                    showBuildingConfirmation = true
                )
            }

            // Run generation in background
            generationJob = viewModelScope.launch {
                var queuedProjectId: String? = null
                try {
                    projectRepository.generate(
                        prompt = prompt,
                        userId = userId,
                        userName = userName,
                        referenceImage = currentState.referenceImageBase64
                    ).collect { event ->
                        when (event) {
                            is SseEvent.Queued -> {
                                queuedProjectId = event.projectId
                                Log.d("Create", "Build queued: projectId=${event.projectId}")
                            }
                            is SseEvent.Status -> {
                                // Silently track progress in background
                            }
                            is SseEvent.Result -> {
                                handleGenerationResult(event)
                            }
                            is SseEvent.Error -> {
                                Log.w("Create", "SSE error during generation: ${event.error}")
                                if (event.systemBusy) {
                                    _uiState.update {
                                        it.copy(isGenerating = false, showSystemBusyDialog = true)
                                    }
                                } else {
                                    // Start polling if we have a projectId — build may still be running
                                    val pid = queuedProjectId
                                    if (pid != null) {
                                        pollForProjectById(pid)
                                    }
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.w("Create", "SSE stream dropped: ${e.message}")
                    // If we have a projectId, poll for completion
                    val pid = queuedProjectId
                    if (pid != null) {
                        pollForProjectById(pid)
                    }
                }
            }
        }
    }

    private fun pollForProjectById(projectId: String) {
        viewModelScope.launch {
            // Poll every 10 seconds for up to 5 minutes
            val maxAttempts = 30
            for (attempt in 1..maxAttempts) {
                kotlinx.coroutines.delay(10_000)

                try {
                    val project = projectRepository.getProject(projectId)
                    if (project != null && project.status == "ready") {
                        Log.d("Create", "Project $projectId ready via polling")
                        userPreferences.clearPendingGeneration()
                        NotificationHelper.showGenerationComplete(appContext)
                        return@launch
                    }
                } catch (e: Exception) {
                    Log.d("Create", "Poll attempt $attempt failed: ${e.message}")
                }
            }
            userPreferences.clearPendingGeneration()
        }
    }

    private fun pollForCompletedProject(userId: String) {
        _uiState.update {
            it.copy(
                buildPhase = "Still building...",
                buildDetail = "Connection lost — checking for your project",
                progressPercent = 80.0
            )
        }

        viewModelScope.launch {
            // Poll every 10 seconds for up to 5 minutes
            val maxAttempts = 30
            val prompt = _uiState.value.prompt
            for (attempt in 1..maxAttempts) {
                kotlinx.coroutines.delay(10_000)

                if (!_uiState.value.isGenerating) return@launch // Cancelled

                _uiState.update {
                    it.copy(buildDetail = "Checking for your project... (${attempt * 10}s)")
                }

                try {
                    val projects = projectRepository.getMyProjects(userId)
                    // Find a recently created project matching our prompt
                    val match = projects.firstOrNull { p ->
                        p.description == prompt || p.title.lowercase().startsWith(
                            prompt.trim().split("\\s+".toRegex()).take(4).joinToString(" ").lowercase().take(30)
                        )
                    }

                    if (match != null) {
                        Log.d("Create", "Found completed project via polling: ${match.id}")
                        userPreferences.clearPendingGeneration()
                        _uiState.update {
                            it.copy(
                                isGenerating = false,
                                progressPercent = 100.0,
                                buildPhase = appContext.getString(R.string.generation_phase_complete),
                                savedProjectId = match.id,
                                showPreview = false,
                                errorMessage = "Your app is ready! Check 'My Projects' to view it."
                            )
                        }
                        NotificationHelper.showGenerationComplete(appContext)
                        return@launch
                    }
                } catch (e: Exception) {
                    Log.d("Create", "Poll attempt $attempt failed: ${e.message}")
                }
            }

            // Timed out
            userPreferences.clearPendingGeneration()
            _uiState.update {
                it.copy(
                    isGenerating = false,
                    errorMessage = "Your app may still be building. Check 'My Projects' in a minute."
                )
            }
        }
    }

    private fun handleGenerationResult(result: SseEvent.Result) {
        viewModelScope.launch { userPreferences.clearPendingGeneration() }

        // Project is auto-saved server-side. Just notify the user.
        Log.d("Create", "Generation complete: projectId=${result.projectId}, previewUrl=${result.previewUrl}")
        NotificationHelper.showGenerationComplete(appContext)

        // Show rating prompt on first successful generation
        viewModelScope.launch {
            val alreadyShown = userPreferences.hasShownRatingPrompt.first()
            if (!alreadyShown) {
                userPreferences.markRatingPromptShown()
                _uiState.update { it.copy(showRatingPrompt = true) }
            }
        }
    }

    fun dismissBuildingConfirmation() {
        _uiState.update { it.copy(showBuildingConfirmation = false) }
    }

    fun dismissRatingPrompt() {
        _uiState.update { it.copy(showRatingPrompt = false) }
    }

    fun cancelGeneration() {
        generationJob?.cancel()
        _uiState.update {
            it.copy(
                isGenerating = false,
                progressPercent = 0.0,
                buildPhase = "",
                buildDetail = ""
            )
        }
    }

    fun saveProject() {
        val currentState = _uiState.value
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
                                    bundleDir = bundleDir,
                                    bundleBase64 = event.bundle,
                                    versionNumber = it.versionNumber + 1
                                )
                            }
                        }
                        is SseEvent.Error -> {
                            _uiState.update {
                                it.copy(isTweaking = false, tweakPhase = "", errorMessage = event.error)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isTweaking = false, tweakPhase = "", errorMessage = "Tweak failed: ${e.message}")
                }
            }
        }
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
