package com.kreativekoala.vibecoder.ui.apps

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.util.NotificationHelper
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
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
    @ApplicationContext private val appContext: Context,
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

                // Notify if any previously-building project is now ready
                val previousBuildingIds = _uiState.value.projects
                    .filter { it.status == "building" }.map { it.id }.toSet()
                val newlyReady = projects.filter { it.id in previousBuildingIds && it.status == "ready" }
                if (newlyReady.isNotEmpty()) {
                    NotificationHelper.showGenerationComplete(
                        appContext,
                        title = "\"${newlyReady.first().title}\" is ready!",
                        body = "Tap to open your app"
                    )
                }

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

    fun retryProject(project: Project) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            // Optimistically flip card to building by updating the status in-list
            updateProjectStatus(project.id, "building")
            try {
                projectRepository.retryProject(project.id, userId)
            } catch (e: Exception) {
                updateProjectStatus(project.id, "failed")
            }
        }
    }

    private fun updateProjectStatus(projectId: String, status: String) {
        _uiState.update { state ->
            state.copy(projects = state.projects.map { p ->
                if (p.id == projectId) Project(
                    id = p.id, title = p.title, description = p.description,
                    creatorId = p.creatorId, creatorName = p.creatorName,
                    projectType = p.projectType, isPublic = p.isPublic,
                    isFeatured = p.isFeatured, playCount = p.playCount,
                    viewCount = p.viewCount, forkCount = p.forkCount,
                    rating = p.rating, initialPrompt = p.initialPrompt,
                    githubRepo = p.githubRepo, tweakCount = p.tweakCount,
                    freeTweaksRemaining = p.freeTweaksRemaining,
                    publishedUrl = p.publishedUrl, previewUrl = p.previewUrl,
                    thumbnailUrl = p.thumbnailUrl, status = status,
                    parentProjectId = p.parentProjectId,
                    creationMethod = p.creationMethod,
                    createdAt = p.createdAt, updatedAt = p.updatedAt
                ) else p
            })
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
