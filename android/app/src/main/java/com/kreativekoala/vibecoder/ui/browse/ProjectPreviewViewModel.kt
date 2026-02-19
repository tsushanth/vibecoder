package com.kreativekoala.vibecoder.ui.browse

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.util.ZipExtractor
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

data class ProjectPreviewUiState(
    val project: Project? = null,
    val isLoading: Boolean = false,
    val bundleDir: File? = null,
    val showPreview: Boolean = false,
    val isForkingProject: Boolean = false,
    val forkedProjectId: String? = null,
    val errorMessage: String? = null
)

@HiltViewModel
class ProjectPreviewViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val projectRepository: ProjectRepository,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProjectPreviewUiState())
    val uiState: StateFlow<ProjectPreviewUiState> = _uiState.asStateFlow()

    fun loadProject(projectId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            try {
                val project = projectRepository.getProject(projectId)
                _uiState.update { it.copy(project = project, isLoading = false) }

                // Auto-extract bundle for preview
                if (project?.bundle != null) {
                    val bundleDir = withContext(Dispatchers.IO) {
                        ZipExtractor.extractBundle(project.bundle, appContext.cacheDir)
                    }
                    _uiState.update { it.copy(bundleDir = bundleDir, showPreview = true) }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isLoading = false, errorMessage = e.message)
                }
            }
        }
    }

    fun forkProject() {
        val project = _uiState.value.project ?: return
        val userId = authRepository.currentUser?.uid ?: return
        val userName = authRepository.currentUser?.displayName

        viewModelScope.launch {
            _uiState.update { it.copy(isForkingProject = true) }

            try {
                val forkedId = projectRepository.forkProject(
                    projectId = project.id,
                    userId = userId,
                    userName = userName,
                    newTitle = "${project.title} (Fork)"
                )
                _uiState.update {
                    it.copy(
                        isForkingProject = false,
                        forkedProjectId = forkedId
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isForkingProject = false,
                        errorMessage = "Fork failed: ${e.message}"
                    )
                }
            }
        }
    }
}
