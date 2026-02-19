package com.kreativekoala.vibecoder.ui.apps

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.Project
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

data class ProjectDetailUiState(
    val project: Project? = null,
    val isLoading: Boolean = false,
    val isLoadingPreview: Boolean = false,
    val showPreview: Boolean = false,
    val bundleDir: File? = null,
    val errorMessage: String? = null
)

@HiltViewModel
class ProjectDetailViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val projectRepository: ProjectRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProjectDetailUiState())
    val uiState: StateFlow<ProjectDetailUiState> = _uiState.asStateFlow()

    fun loadProject(projectId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            try {
                val project = projectRepository.getProject(projectId)
                Log.d("ProjectDetail", "Loaded project: ${project?.title}, bundle present: ${project?.bundle != null}, bundle length: ${project?.bundle?.length ?: 0}")
                _uiState.update { it.copy(project = project, isLoading = false) }
            } catch (e: Exception) {
                Log.e("ProjectDetail", "Failed to load project: ${e.message}", e)
                _uiState.update {
                    it.copy(isLoading = false, errorMessage = e.message)
                }
            }
        }
    }

    fun loadPreview() {
        val project = _uiState.value.project
        val bundle = project?.bundle
        if (bundle == null) {
            Log.e("ProjectDetail", "Cannot preview: bundle is null for project ${project?.id}")
            _uiState.update { it.copy(errorMessage = "Preview not available — bundle data missing") }
            return
        }
        Log.d("ProjectDetail", "Loading preview, bundle size: ${bundle.length}")

        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingPreview = true) }

            try {
                val bundleDir = withContext(Dispatchers.IO) {
                    ZipExtractor.extractBundle(bundle, appContext.cacheDir)
                }
                _uiState.update {
                    it.copy(
                        isLoadingPreview = false,
                        bundleDir = bundleDir,
                        showPreview = true
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoadingPreview = false,
                        errorMessage = "Failed to load preview: ${e.message}"
                    )
                }
            }
        }
    }

    fun hidePreview() {
        _uiState.update { it.copy(showPreview = false) }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}
