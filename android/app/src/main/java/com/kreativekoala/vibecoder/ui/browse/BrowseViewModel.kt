package com.kreativekoala.vibecoder.ui.browse

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class SortOption(val value: String, val label: String) {
    NEWEST("newest", "Newest"),
    POPULAR("popular", "Popular")
}

data class BrowseUiState(
    val projects: List<Project> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val sortOption: SortOption = SortOption.NEWEST,
    val errorMessage: String? = null,
    val isForkingId: String? = null
)

@HiltViewModel
class BrowseViewModel @Inject constructor(
    private val projectRepository: ProjectRepository,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(BrowseUiState())
    val uiState: StateFlow<BrowseUiState> = _uiState.asStateFlow()

    init {
        loadProjects()
    }

    fun loadProjects() {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = it.projects.isEmpty(),
                    isRefreshing = it.projects.isNotEmpty()
                )
            }

            try {
                val projects = projectRepository.browseProjects(
                    sort = _uiState.value.sortOption.value
                )
                _uiState.update {
                    it.copy(
                        // Fall back to seed content when the server returns nothing
                        projects = projects.ifEmpty { sampleProjects },
                        isLoading = false,
                        isRefreshing = false
                    )
                }
            } catch (e: Exception) {
                // On network/auth failure, still show seed content so the page is never empty.
                _uiState.update {
                    it.copy(
                        projects = sampleProjects,
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = null
                    )
                }
            }
        }
    }

    /// Seed projects shown when the discover API returns no results.
    private val sampleProjects: List<Project> = listOf(
        Project(id = "sample-todo", title = "Todo List App",
                description = "A clean task tracker with categories and due dates.",
                creatorName = "VibeBuild Team", playCount = 1240, forkCount = 87),
        Project(id = "sample-pomodoro", title = "Pomodoro Timer",
                description = "Focus timer with work and break intervals.",
                creatorName = "VibeBuild Team", playCount = 980, forkCount = 64),
        Project(id = "sample-weather", title = "Weather Dashboard",
                description = "Current weather and 5-day forecast for any city.",
                creatorName = "VibeBuild Team", playCount = 870, forkCount = 52),
        Project(id = "sample-recipes", title = "Recipe Finder",
                description = "Find recipes by ingredients you have at home.",
                creatorName = "VibeBuild Team", playCount = 740, forkCount = 41),
        Project(id = "sample-budget", title = "Budget Tracker",
                description = "Track expenses and visualize where your money goes.",
                creatorName = "VibeBuild Team", playCount = 690, forkCount = 38),
        Project(id = "sample-quiz", title = "Trivia Quiz Game",
                description = "Multi-category quiz with score tracking.",
                creatorName = "VibeBuild Team", playCount = 610, forkCount = 33)
    )

    fun changeSortOption(option: SortOption) {
        _uiState.update { it.copy(sortOption = option) }
        loadProjects()
    }

    fun forkProject(projectId: String) {
        val userId = authRepository.currentUser?.uid ?: return
        val userName = authRepository.currentUser?.displayName

        viewModelScope.launch {
            _uiState.update { it.copy(isForkingId = projectId) }

            try {
                projectRepository.forkProject(
                    projectId = projectId,
                    userId = userId,
                    userName = userName,
                    newTitle = null
                )
                _uiState.update { it.copy(isForkingId = null) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isForkingId = null,
                        errorMessage = "Fork failed: ${e.message}"
                    )
                }
            }
        }
    }
}
