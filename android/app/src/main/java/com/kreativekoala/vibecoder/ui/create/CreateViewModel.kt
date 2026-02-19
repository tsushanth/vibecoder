package com.kreativekoala.vibecoder.ui.create

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.data.model.SseEvent
import com.kreativekoala.vibecoder.data.model.Suggestion
import com.kreativekoala.vibecoder.data.repository.AuthRepository
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
    val estimatedSecondsRemaining: Int = 0,
    val errorMessage: String? = null,
    val bundleDir: File? = null,
    val bundleBase64: String? = null,
    val showPreview: Boolean = false,
    val isSaving: Boolean = false,
    val savedProjectId: String? = null,
    val suggestions: List<Suggestion> = emptyList(),
    val prompt: String = "",
    val referenceImageBase64: String? = null
)

@HiltViewModel
class CreateViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val projectRepository: ProjectRepository,
    private val authRepository: AuthRepository,
    private val subscriptionRepository: SubscriptionRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(CreateUiState())
    val uiState: StateFlow<CreateUiState> = _uiState.asStateFlow()

    private var generationJob: Job? = null

    private val fallbackSuggestions = listOf(
        Suggestion("Todo App", "Build a clean todo list app with add, complete, and delete functionality. Use local storage to persist tasks."),
        Suggestion("Weather App", "Create a weather app that shows current conditions and 5-day forecast with a clean card-based layout."),
        Suggestion("Calculator", "Create a scientific calculator with basic operations, square root, percentage, and memory functions."),
        Suggestion("Pomodoro Timer", "Build a focus timer with 25-minute work sessions and 5-minute breaks. Minimalist design."),
        Suggestion("Markdown Editor", "Create a split-pane markdown editor with live preview. Support headings, lists, links, and code blocks."),
        Suggestion("Color Palette", "Build a tool that generates harmonious color palettes. Show hex codes and allow copying to clipboard.")
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

        val userId = authRepository.currentUser?.uid ?: return
        val userName = authRepository.currentUser?.displayName ?: "VibeBuild User"

        // Check usage limits
        viewModelScope.launch {
            try {
                val usage = subscriptionRepository.recordUsage(userId, "generation")
                if (!usage.success && usage.remaining != null && usage.remaining <= 0) {
                    _uiState.update {
                        it.copy(errorMessage = "Daily generation limit reached. Upgrade to Pro for unlimited generations.")
                    }
                    return@launch
                }
            } catch (_: Exception) {
                // Continue even if usage check fails
            }

            _uiState.update {
                it.copy(
                    isGenerating = true,
                    progressPercent = 0.0,
                    buildPhase = "Connecting...",
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
                            errorMessage = e.message ?: "Generation failed"
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
                    buildPhase = "Complete!",
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
                    errorMessage = "Failed to extract project: ${e.message}"
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
            .ifBlank { "My Project" }

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
                        errorMessage = "Failed to save: ${e.message}"
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
                savedProjectId = null
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}
