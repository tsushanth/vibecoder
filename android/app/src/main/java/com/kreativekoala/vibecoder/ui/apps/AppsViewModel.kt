package com.kreativekoala.vibecoder.ui.apps

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
import android.util.Log
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AppsUiState(
    val projects: List<Project> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null
)

@HiltViewModel
class AppsViewModel @Inject constructor(
    private val projectRepository: ProjectRepository,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AppsUiState())
    val uiState: StateFlow<AppsUiState> = _uiState.asStateFlow()

    init {
        loadProjects()
    }

    fun loadProjects() {
        val userId = authRepository.currentUser?.uid ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = it.projects.isEmpty(), isRefreshing = it.projects.isNotEmpty()) }

            try {
                val projects = projectRepository.getMyProjects(userId)
                Log.d("Apps", "Loaded ${projects.size} projects: ${projects.map { "${it.title.take(20)}(${it.status})" }}")
                _uiState.update {
                    it.copy(
                        projects = projects,
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = null
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

    fun deleteProject(projectId: String) {
        val userId = authRepository.currentUser?.uid ?: return

        viewModelScope.launch {
            try {
                projectRepository.deleteProject(projectId, userId)
                _uiState.update { state ->
                    state.copy(projects = state.projects.filter { it.id != projectId })
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(errorMessage = "Failed to delete: ${e.message}") }
            }
        }
    }
}
