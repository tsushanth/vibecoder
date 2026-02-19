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
                        projects = projects,
                        isLoading = false,
                        isRefreshing = false
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = e.message
                    )
                }
            }
        }
    }

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
