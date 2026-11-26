package com.kreativekoala.vibecoder.ui.browse

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ForkRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.preview.UrlWebViewComposable
import com.kreativekoala.vibecoder.ui.preview.WebViewComposable
import com.kreativekoala.vibecoder.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectPreviewScreen(
    projectId: String,
    onBack: () -> Unit,
    viewModel: ProjectPreviewViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(projectId) {
        viewModel.loadProject(projectId)
    }

    // A failed remix must be visible while the preview fills the screen (the full-screen error below only shows without one).
    val snackbar = remember { SnackbarHostState() }
    val hasPreview = uiState.bundleDir != null || uiState.project?.publishedUrl != null
    LaunchedEffect(uiState.errorMessage, hasPreview) {
        val message = uiState.errorMessage
        if (hasPreview && message != null) snackbar.showSnackbar(message)
    }

    Scaffold(
        containerColor = DarkBackground,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(uiState.project?.title ?: stringResource(R.string.preview_screen_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.back),
                            tint = TextPrimary
                        )
                    }
                },
                actions = {
                    // Fork button
                    if (uiState.canRemix) {
                        Button(
                            onClick = { viewModel.forkProject() },
                            enabled = !uiState.isForkingProject && uiState.forkedProjectId == null,
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
                        ) {
                            if (uiState.isForkingProject) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    color = TextPrimary,
                                    strokeWidth = 2.dp
                                )
                            } else if (uiState.forkedProjectId != null) {
                                Text(stringResource(R.string.project_preview_btn_forked), fontWeight = FontWeight.SemiBold)
                            } else {
                                Icon(
                                    Icons.Default.ForkRight,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(stringResource(R.string.project_preview_btn_fork), fontWeight = FontWeight.SemiBold)
                            }
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkSurface,
                    titleContentColor = TextPrimary
                )
            )
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when {
                uiState.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(color = VibePurple)
                    }
                }

                uiState.bundleDir != null -> {
                    WebViewComposable(
                        bundleDir = uiState.bundleDir!!,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                // Fallback: load deployed URL if bundle is unavailable
                uiState.project?.publishedUrl != null -> {
                    UrlWebViewComposable(
                        url = uiState.project!!.publishedUrl!!,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                uiState.errorMessage != null -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text(
                            text = stringResource(R.string.project_preview_error_title),
                            style = MaterialTheme.typography.titleMedium,
                            color = ErrorRed
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = uiState.errorMessage ?: "",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                    }
                }

                uiState.project != null -> {
                    // Project loaded but bundle and published URL unavailable
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text(
                            text = stringResource(R.string.project_preview_unavailable),
                            style = MaterialTheme.typography.titleMedium,
                            color = TextSecondary
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = stringResource(R.string.project_preview_unavailable_body),
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                    }
                }
            }
        }
    }
}
