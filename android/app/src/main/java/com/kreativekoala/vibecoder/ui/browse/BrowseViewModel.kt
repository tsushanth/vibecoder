package com.kreativekoala.vibecoder.ui.browse

import dagger.hilt.android.qualifiers.ApplicationContext
import android.content.Context
import androidx.annotation.StringRes
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.util.appString
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

enum class SortOption(val value: String, @StringRes val labelRes: Int) {
    NEWEST("newest", R.string.browse_sort_newest),
    POPULAR("popular", R.string.browse_sort_popular)
}

data class BrowseUiState(
    val projects: List<Project> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val sortOption: SortOption = SortOption.NEWEST,
    val errorMessage: String? = null,
    val isForkingId: String? = null,
    val category: ProjectCategory = ProjectCategory.ALL
) {
    val visibleProjects: List<Project>
        get() = if (category == ProjectCategory.ALL) projects
        else projects.filter { classify(it) == category }
}

@HiltViewModel
class BrowseViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
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
                        projects = projects.ifEmpty { sampleProjects() },
                        isLoading = false,
                        isRefreshing = false
                    )
                }
            } catch (e: Exception) {
                // On network/auth failure, still show seed content so the page is never empty.
                _uiState.update {
                    it.copy(
                        projects = sampleProjects(),
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = null
                    )
                }
            }
        }
    }

    /// Seed projects shown when the discover API returns no results (built per call so they follow the app language).
    private fun sampleProjects(): List<Project> {
        fun sample(id: String, @StringRes title: Int, @StringRes desc: Int, plays: Int, forks: Int) = Project(
            id = id, title = appContext.appString(title), description = appContext.appString(desc),
            creatorName = appContext.appString(R.string.sample_creator_team), playCount = plays, forkCount = forks
        )
        return listOf(
            sample("sample-todo", R.string.sample_todo_title, R.string.sample_todo_desc, 1240, 87),
            sample("sample-pomodoro", R.string.sample_pomodoro_title, R.string.sample_pomodoro_desc, 980, 64),
            sample("sample-weather", R.string.sample_weather_title, R.string.sample_weather_desc, 870, 52),
            sample("sample-recipes", R.string.sample_recipes_title, R.string.sample_recipes_desc, 740, 41),
            sample("sample-budget", R.string.sample_budget_title, R.string.sample_budget_desc, 690, 38),
            sample("sample-quiz", R.string.sample_quiz_title, R.string.sample_quiz_desc, 610, 33)
        )
    }

    fun changeSortOption(option: SortOption) {
        _uiState.update { it.copy(sortOption = option) }
        loadProjects()
    }

    fun selectCategory(category: ProjectCategory) {
        _uiState.update { it.copy(category = category) }
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
                        errorMessage = appContext.appString(R.string.err_fork_failed, e.message ?: "")
                    )
                }
            }
        }
    }
}
