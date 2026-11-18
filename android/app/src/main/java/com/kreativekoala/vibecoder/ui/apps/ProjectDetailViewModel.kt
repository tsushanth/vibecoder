package com.kreativekoala.vibecoder.ui.apps

import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.util.appString
import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.AppVersion
import com.kreativekoala.vibecoder.data.model.Project
import com.kreativekoala.vibecoder.data.model.SseEvent
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.DeployRepository
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
    val errorMessage: String? = null,
    val isDeploying: Boolean = false,
    val deployedUrl: String? = null,
    val showDeployDialog: Boolean = false,
    val isTweaking: Boolean = false,
    val tweakPhase: String = "",
    val feedbackSent: String? = null,
    val versionNumber: Int = 0,
    val showVersionHistory: Boolean = false,
    val versions: List<AppVersion> = emptyList(),
    val isLoadingVersions: Boolean = false,
    val isReverting: Boolean = false,
    val isExportingApk: Boolean = false,
    val apkExportProgress: String = "",
    val adsEnabled: Boolean = false,
    val deploymentId: String? = null,
    val previewUrl: String? = null
)

@HiltViewModel
class ProjectDetailViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val projectRepository: ProjectRepository,
    private val authRepository: AuthRepository,
    private val deployRepository: DeployRepository
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

                // Check deploy status now that project is loaded
                if (project != null) {
                    try {
                        val status = deployRepository.getDeployStatus(project.id)
                        if (status.deployed && status.url != null) {
                            _uiState.update { it.copy(deployedUrl = status.url, adsEnabled = status.adsEnabled, deploymentId = status.deploymentId) }
                        }
                    } catch (e: Exception) {
                        Log.d("ProjectDetail", "Deploy status check failed: ${e.message}")
                    }
                }

                // Load version count after project is available
                try {
                    val versions = projectRepository.getVersions(projectId)
                    _uiState.update { it.copy(versionNumber = versions.size) }
                } catch (e: Exception) {
                    Log.d("ProjectDetail", "Could not load version count: ${e.message}")
                }
            } catch (e: Exception) {
                Log.e("ProjectDetail", "Failed to load project: ${e.message}", e)
                _uiState.update {
                    it.copy(isLoading = false, errorMessage = e.message)
                }
            }
        }
    }

    fun loadPreview() {
        val project = _uiState.value.project ?: return

        // Prefer URL-based preview (deployed or temp preview)
        val url = project.publishedUrl ?: project.previewUrl
        if (url != null) {
            _uiState.update { it.copy(previewUrl = url, showPreview = true) }
            return
        }

        // No URL — auto-deploy a temp preview
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingPreview = true) }

            try {
                // Deploy to a temp preview subdomain
                val previewSubdomain = "preview-${project.id.take(12)}"
                val response = deployRepository.deploy(project.id, userId, previewSubdomain)
                if (response.success && response.url != null) {
                    _uiState.update {
                        it.copy(
                            isLoadingPreview = false,
                            previewUrl = response.url,
                            deployedUrl = response.url,
                            showPreview = true
                        )
                    }
                } else {
                    _uiState.update {
                        it.copy(isLoadingPreview = false, errorMessage = appContext.appString(R.string.err_preview_create))
                    }
                }
            } catch (e: Exception) {
                Log.e("ProjectDetail", "Auto-deploy preview failed: ${e.message}", e)
                _uiState.update {
                    it.copy(isLoadingPreview = false, errorMessage = appContext.appString(R.string.err_preview_failed, e.message ?: ""))
                }
            }
        }
    }

    fun hidePreview() {
        _uiState.update { it.copy(showPreview = false) }
    }

    fun showDeployDialog() {
        _uiState.update { it.copy(showDeployDialog = true) }
    }

    fun dismissDeployDialog() {
        _uiState.update { it.copy(showDeployDialog = false) }
    }

    fun deployProject(subdomain: String) {
        val project = _uiState.value.project ?: return
        val userId = authRepository.currentUser?.uid ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isDeploying = true, showDeployDialog = false) }

            try {
                val response = deployRepository.deploy(
                    projectId = project.id,
                    userId = userId,
                    subdomain = subdomain.trim().lowercase()
                )
                if (response.success && response.url != null) {
                    _uiState.update {
                        it.copy(
                            isDeploying = false,
                            deployedUrl = response.url
                        )
                    }
                    // Reload project to get updated publishedUrl
                    loadProject(project.id)
                } else {
                    _uiState.update {
                        it.copy(
                            isDeploying = false,
                            errorMessage = appContext.appString(R.string.err_deploy_retry)
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e("ProjectDetail", appContext.appString(R.string.err_deploy_failed, e.message ?: ""), e)
                _uiState.update {
                    it.copy(
                        isDeploying = false,
                        errorMessage = appContext.appString(R.string.err_deploy_failed, e.message ?: "")
                    )
                }
            }
        }
    }

    fun checkDeployStatus() {
        val project = _uiState.value.project ?: return

        viewModelScope.launch {
            try {
                val status = deployRepository.getDeployStatus(project.id)
                if (status.deployed && status.url != null) {
                    _uiState.update { it.copy(deployedUrl = status.url, deploymentId = status.deploymentId) }
                }
            } catch (e: Exception) {
                Log.d("ProjectDetail", "Deploy status check failed: ${e.message}")
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    // MARK: - Tweak

    fun tweakProject(tweakDescription: String) {
        val desc = tweakDescription.trim()
        if (desc.isEmpty()) return

        val projectId = _uiState.value.project?.id ?: return
        val userId = authRepository.currentUser?.uid ?: run {
            _uiState.update { it.copy(errorMessage = appContext.appString(R.string.err_sign_in_changes)) }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isTweaking = true, tweakPhase = appContext.appString(R.string.progress_applying_changes)) }

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
                            val bundleDir = withContext(Dispatchers.IO) {
                                ZipExtractor.extractBundle(event.bundle, appContext.cacheDir)
                            }
                            _uiState.update {
                                it.copy(
                                    isTweaking = false,
                                    tweakPhase = "",
                                    bundleDir = bundleDir,
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
                    it.copy(isTweaking = false, tweakPhase = "", errorMessage = appContext.appString(R.string.err_failed_reason, e.message ?: ""))
                }
            }
        }
    }

    // MARK: - Feedback

    fun sendFeedback(rating: String) {
        val projectId = _uiState.value.project?.id ?: return
        val userId = authRepository.currentUser?.uid ?: return

        _uiState.update { it.copy(feedbackSent = rating) }

        viewModelScope.launch {
            try {
                projectRepository.sendFeedback(projectId, userId, rating)
            } catch (e: Exception) {
                Log.e("ProjectDetail", "Feedback failed: ${e.message}")
            }
        }
    }

    // MARK: - Version History

    fun loadVersionNumber() {
        val projectId = _uiState.value.project?.id ?: return

        viewModelScope.launch {
            try {
                val versions = projectRepository.getVersions(projectId)
                _uiState.update { it.copy(versionNumber = versions.size) }
            } catch (e: Exception) {
                Log.d("ProjectDetail", "Could not load version count: ${e.message}")
            }
        }
    }

    fun showVersionHistory() {
        _uiState.update { it.copy(showVersionHistory = true, isLoadingVersions = true) }

        val projectId = _uiState.value.project?.id ?: return

        viewModelScope.launch {
            try {
                val versions = projectRepository.getVersions(projectId)
                _uiState.update {
                    it.copy(versions = versions, isLoadingVersions = false)
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoadingVersions = false,
                        errorMessage = appContext.appString(R.string.err_versions_load)
                    )
                }
            }
        }
    }

    fun dismissVersionHistory() {
        _uiState.update { it.copy(showVersionHistory = false) }
    }

    fun revertToVersion(sha: String) {
        val projectId = _uiState.value.project?.id ?: return
        val userId = authRepository.currentUser?.uid ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isReverting = true) }

            try {
                val response = projectRepository.revertToVersion(projectId, sha, userId)
                if (response.success && response.bundle != null) {
                    val bundleDir = withContext(Dispatchers.IO) {
                        ZipExtractor.extractBundle(response.bundle, appContext.cacheDir)
                    }
                    // Reload versions to get correct count
                    val versions = projectRepository.getVersions(projectId)
                    _uiState.update {
                        it.copy(
                            isReverting = false,
                            showVersionHistory = false,
                            bundleDir = bundleDir,
                            versionNumber = versions.size,
                            versions = versions
                        )
                    }
                } else {
                    _uiState.update {
                        it.copy(isReverting = false, errorMessage = appContext.appString(R.string.err_version_restore))
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isReverting = false, errorMessage = appContext.appString(R.string.err_restore_failed, e.message ?: ""))
                }
            }
        }
    }

    // MARK: - Ads Toggle

    fun toggleAds(enabled: Boolean) {
        val project = _uiState.value.project ?: return
        val userId = authRepository.currentUser?.uid ?: return

        viewModelScope.launch {
            try {
                val response = deployRepository.toggleAds(project.id, userId, enabled)
                _uiState.update { it.copy(adsEnabled = response.adsEnabled) }
            } catch (e: Exception) {
                Log.e("ProjectDetail", "Toggle ads failed: ${e.message}")
                _uiState.update { it.copy(errorMessage = appContext.appString(R.string.err_ads_update, e.message ?: "")) }
            }
        }
    }

    // MARK: - Export APK

    fun exportApk() {
        val project = _uiState.value.project ?: return
        val userId = authRepository.currentUser?.uid ?: run {
            _uiState.update { it.copy(errorMessage = appContext.appString(R.string.err_sign_in_export)) }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isExportingApk = true, apkExportProgress = appContext.appString(R.string.progress_building_android)) }

            try {
                val response = projectRepository.exportApk(project.id, userId, project.bundle)
                if (response.success && response.apk != null) {
                    _uiState.update { it.copy(apkExportProgress = appContext.appString(R.string.progress_saving_apk)) }

                    // Save APK to Downloads
                    val bytes = android.util.Base64.decode(response.apk, android.util.Base64.DEFAULT)
                    // Latin letters and digits only; a title in another script (Thai, Arabic, CJK) would otherwise give a nameless ".apk"
                    val fileName = "${project.title.replace(Regex("[^a-zA-Z0-9 ]"), "").trim().replace(" ", "_").ifBlank { "app" }}.apk" // i18n-ok: file name
                    val downloadsDir = appContext.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS)
                    val apkFile = java.io.File(downloadsDir, fileName)
                    apkFile.writeBytes(bytes)

                    Log.d("ProjectDetail", "APK saved: ${apkFile.absolutePath} (${bytes.size} bytes)")

                    _uiState.update {
                        it.copy(
                            isExportingApk = false,
                            apkExportProgress = "",
                            errorMessage = null
                        )
                    }

                    // Trigger install
                    installApk(apkFile)
                } else {
                    _uiState.update {
                        it.copy(
                            isExportingApk = false,
                            apkExportProgress = "",
                            errorMessage = response.error ?: "APK build failed"
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e("ProjectDetail", "APK export failed: ${e.message}", e)
                _uiState.update {
                    it.copy(
                        isExportingApk = false,
                        apkExportProgress = "",
                        errorMessage = appContext.appString(R.string.err_export_failed, e.message ?: "")
                    )
                }
            }
        }
    }

    private fun installApk(apkFile: java.io.File) {
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                appContext,
                "${appContext.packageName}.fileprovider",
                apkFile
            )
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            appContext.startActivity(intent)
        } catch (e: Exception) {
            Log.e("ProjectDetail", "Install APK failed: ${e.message}", e)
            _uiState.update { it.copy(errorMessage = appContext.appString(R.string.err_apk_installer)) }
        }
    }
}
