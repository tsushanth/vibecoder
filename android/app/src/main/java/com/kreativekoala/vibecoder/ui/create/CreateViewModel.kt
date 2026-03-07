package com.kreativekoala.vibecoder.ui.create

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.data.model.SseEvent
import com.kreativekoala.vibecoder.data.model.Suggestion
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.DeployRepository
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.data.repository.SubscriptionRepository
import com.kreativekoala.vibecoder.util.NotificationHelper
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
    val feedbackSent: String? = null
)

@HiltViewModel
class CreateViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val projectRepository: ProjectRepository,
    private val authRepository: AuthRepository,
    private val subscriptionRepository: SubscriptionRepository,
    private val deployRepository: DeployRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(CreateUiState())
    val uiState: StateFlow<CreateUiState> = _uiState.asStateFlow()

    private var generationJob: Job? = null

    private val fallbackSuggestions = listOf(
        Suggestion(appContext.getString(R.string.suggestion_label_todo_app), "Build a clean todo list app with add, complete, and delete functionality. Use local storage to persist tasks."),
        Suggestion(appContext.getString(R.string.suggestion_label_weather_app), "Create a weather app that shows current conditions and 5-day forecast with a clean card-based layout."),
        Suggestion(appContext.getString(R.string.suggestion_label_calculator), "Create a scientific calculator with basic operations, square root, percentage, and memory functions."),
        Suggestion(appContext.getString(R.string.suggestion_label_pomodoro_timer), "Build a focus timer with 25-minute work sessions and 5-minute breaks. Minimalist design."),
        Suggestion(appContext.getString(R.string.suggestion_label_markdown_editor), "Create a split-pane markdown editor with live preview. Support headings, lists, links, and code blocks."),
        Suggestion(appContext.getString(R.string.suggestion_label_color_palette), "Build a tool that generates harmonious color palettes. Show hex codes and allow copying to clipboard.")
    )

    init {
        loadSuggestions()
    }

    private fun loadSuggestions() {
        // Show fallbacks immediately
        _uiState.update { it.copy(suggestions = fallbackSuggestions) }

        viewModelScope.launch {
            try {
                val suggestions = projectRepository.getSuggestions()
                if (suggestions.isNotEmpty()) {
                    _uiState.update { it.copy(suggestions = suggestions) }
                }
                Log.d("Create", "Loaded ${suggestions.size} suggestions from API")
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
                }
            } catch (e: Exception) {
                // Fallback: reshuffle from API
                try {
                    val suggestions = projectRepository.getSuggestions()
                    if (suggestions.isNotEmpty()) {
                        _uiState.update { it.copy(suggestions = suggestions) }
                    }
                } catch (_: Exception) {}
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

    fun startGeneration() {
        val currentState = _uiState.value
        val prompt = currentState.prompt.trim()
        if (prompt.isEmpty()) return

        val userId = authRepository.currentUser?.uid ?: run {
            _uiState.update { it.copy(errorMessage = "Please sign in to generate projects") }
            return
        }
        val userName = authRepository.currentUser?.displayName ?: "VibeBuild User"

        viewModelScope.launch {
            // TODO: Re-enable subscription usage check when backend tables exist
            _uiState.update {
                it.copy(
                    isGenerating = true,
                    progressPercent = 0.0,
                    simulatedProgress = 0.0,
                    notifyEnabled = false,
                    buildPhase = appContext.getString(R.string.generation_phase_connecting),
                    buildDetail = "",
                    estimatedSecondsRemaining = 0,
                    errorMessage = null,
                    bundleDir = null,
                    bundleBase64 = null,
                    showPreview = false,
                    savedProjectId = null
                )
            }

            generationJob = viewModelScope.launch {
                try {
                    projectRepository.generate(
                        prompt = prompt,
                        userId = userId,
                        userName = userName,
                        referenceImage = currentState.referenceImageBase64
                    ).collect { event ->
                        when (event) {
                            is SseEvent.Status -> {
                                _uiState.update {
                                    it.copy(
                                        buildPhase = event.phase,
                                        buildDetail = event.detail.ifEmpty { event.message },
                                        progressPercent = event.resolvedProgress(),
                                        estimatedSecondsRemaining = event.resolvedEta()?.toInt() ?: 0
                                    )
                                }
                            }
                            is SseEvent.Result -> {
                                handleGenerationResult(event)
                            }
                            is SseEvent.Error -> {
                                _uiState.update {
                                    it.copy(
                                        isGenerating = false,
                                        errorMessage = event.error
                                    )
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    _uiState.update {
                        it.copy(
                            isGenerating = false,
                            errorMessage = e.message ?: appContext.getString(R.string.create_error_generation_failed)
                        )
                    }
                }
            }
        }
    }

    private fun handleGenerationResult(result: SseEvent.Result) {
        try {
            val bundleDir = ZipExtractor.extractBundle(
                base64Bundle = result.bundle,
                cacheDir = appContext.cacheDir
            )

            _uiState.update {
                it.copy(
                    isGenerating = false,
                    progressPercent = 100.0,
                    buildPhase = appContext.getString(R.string.generation_phase_complete),
                    bundleDir = bundleDir,
                    bundleBase64 = result.bundle,
                    showPreview = true
                )
            }

            // Notify user that generation is complete
            NotificationHelper.showGenerationComplete(appContext)

            // Clean up old cached projects
            ZipExtractor.cleanupOldProjects(appContext.cacheDir)
        } catch (e: Exception) {
            _uiState.update {
                it.copy(
                    isGenerating = false,
                    errorMessage = appContext.getString(R.string.create_error_extract_failed, e.message ?: "")
                )
            }
        }
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
                feedbackSent = null
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
                                    bundleBase64 = event.bundle
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
