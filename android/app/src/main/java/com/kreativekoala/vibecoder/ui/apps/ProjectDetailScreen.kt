package com.kreativekoala.vibecoder.ui.apps

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Rocket
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.ratingkit.RatingKit
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.preview.LivePreviewScreen
import com.kreativekoala.vibecoder.ui.preview.VersionHistorySheet
import com.kreativekoala.vibecoder.ui.theme.*
import com.kreativekoala.vibecoder.util.DateUtil

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailScreen(
    projectId: String,
    onBack: () -> Unit,
    viewModel: ProjectDetailViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    var subdomainInput by remember { mutableStateOf("") }

    LaunchedEffect(projectId) {
        viewModel.loadProject(projectId)
    }

    // Track APK export success as a rating-prompt action peak
    var wasExportingApk by remember { mutableStateOf(false) }
    LaunchedEffect(uiState.isExportingApk) {
        if (wasExportingApk && !uiState.isExportingApk && uiState.errorMessage == null) {
            (context as? android.app.Activity)?.let { RatingKit.trackAction(it) }
        }
        wasExportingApk = uiState.isExportingApk
    }

    // Deploy subdomain dialog
    if (uiState.showDeployDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissDeployDialog() },
            title = { Text(stringResource(R.string.project_detail_deploy_dialog_title)) },
            text = {
                Column {
                    Text(
                        stringResource(R.string.project_detail_deploy_dialog_message),
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = subdomainInput,
                        onValueChange = { subdomainInput = it.lowercase().replace(Regex("[^a-z0-9-]"), "") },
                        label = { Text(stringResource(R.string.project_detail_deploy_label_subdomain)) },
                        suffix = { Text(stringResource(R.string.project_detail_deploy_domain_suffix), color = TextTertiary) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = VibePurple,
                            cursorColor = VibePurple
                        )
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { viewModel.deployProject(subdomainInput) },
                    enabled = subdomainInput.length >= 3
                ) {
                    Text(stringResource(R.string.deploy), color = if (subdomainInput.length >= 3) VibePurple else TextTertiary)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissDeployDialog() }) {
                    Text(stringResource(R.string.cancel))
                }
            },
            containerColor = DarkSurfaceVariant
        )
    }

    // Error dialog
    if (uiState.errorMessage != null) {
        AlertDialog(
            onDismissRequest = { viewModel.clearError() },
            title = { Text(stringResource(R.string.error)) },
            text = { Text(uiState.errorMessage ?: "") },
            confirmButton = {
                TextButton(onClick = { viewModel.clearError() }) {
                    Text(stringResource(R.string.ok), color = VibePurple)
                }
            },
            containerColor = DarkSurfaceVariant
        )
    }

    // Version history bottom sheet
    if (uiState.showVersionHistory) {
        VersionHistorySheet(
            versions = uiState.versions,
            isLoading = uiState.isLoadingVersions,
            isReverting = uiState.isReverting,
            onUseVersion = { sha -> viewModel.revertToVersion(sha) },
            onDismiss = { viewModel.dismissVersionHistory() }
        )
    }

    // Show preview
    if (uiState.showPreview && (uiState.previewUrl != null || uiState.bundleDir != null)) {
        LivePreviewScreen(
            bundleDir = uiState.bundleDir,
            previewUrl = uiState.previewUrl,
            onClose = { viewModel.hidePreview() },
            onSave = {},
            onPublish = { viewModel.showDeployDialog() },
            isSaving = false,
            isSaved = true,
            isDeploying = uiState.isDeploying,
            deployedUrl = uiState.deployedUrl ?: uiState.project?.publishedUrl,
            showDeployDialog = uiState.showDeployDialog,
            onDeployConfirm = { subdomain -> viewModel.deployProject(subdomain) },
            onDeployDismiss = { viewModel.dismissDeployDialog() },
            onTweak = { desc -> viewModel.tweakProject(desc) },
            isTweaking = uiState.isTweaking,
            tweakPhase = uiState.tweakPhase,
            onFeedback = { rating -> viewModel.sendFeedback(rating) },
            feedbackSent = uiState.feedbackSent,
            versionNumber = uiState.versionNumber,
            onVersionHistoryClick = { viewModel.showVersionHistory() }
        )
        return
    }

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                title = { Text(uiState.project?.title ?: stringResource(R.string.project_detail_screen_title_fallback)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.back),
                            tint = TextPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkSurface,
                    titleContentColor = TextPrimary
                )
            )
        }
    ) { innerPadding ->
        when {
            uiState.isLoading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = VibePurple)
                }
            }

            uiState.project != null -> {
                val project = uiState.project!!
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .verticalScroll(rememberScrollState())
                        .padding(20.dp)
                ) {
                    // Hero
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(200.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(
                                Brush.linearGradient(
                                    colors = listOf(
                                        VibePurple.copy(alpha = 0.4f),
                                        VibeBlue.copy(alpha = 0.4f)
                                    )
                                )
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = project.title.take(2).uppercase(),
                            style = MaterialTheme.typography.displayLarge,
                            color = TextPrimary.copy(alpha = 0.4f),
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Spacer(modifier = Modifier.height(20.dp))

                    Text(
                        text = project.title,
                        style = MaterialTheme.typography.headlineMedium,
                        color = TextPrimary,
                        fontWeight = FontWeight.Bold
                    )

                    if (!project.description.isNullOrBlank()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = project.description,
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = stringResource(R.string.project_detail_created_at, DateUtil.relativeTimeString(project.createdAt)),
                        style = MaterialTheme.typography.bodySmall,
                        color = TextTertiary
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    // Preview button
                    Button(
                        onClick = { viewModel.loadPreview() },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                        contentPadding = PaddingValues(vertical = 16.dp),
                        enabled = !uiState.isLoadingPreview
                    ) {
                        if (uiState.isLoadingPreview) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = TextPrimary,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(stringResource(R.string.project_detail_btn_preview), fontWeight = FontWeight.SemiBold)
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    // Deploy section
                    val liveUrl = uiState.deployedUrl ?: project.publishedUrl
                    if (liveUrl != null) {
                        // Already deployed — show URL + actions
                        Card(
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant)
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.Check,
                                        contentDescription = null,
                                        tint = VibeGreen,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        stringResource(R.string.project_detail_badge_deployed),
                                        style = MaterialTheme.typography.titleSmall,
                                        color = VibeGreen,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = liveUrl,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = VibePurple
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                val shareText = stringResource(R.string.project_detail_share_text, liveUrl)
                                val shareTitle = stringResource(R.string.share)
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    OutlinedButton(
                                        onClick = {
                                            context.startActivity(
                                                Intent(Intent.ACTION_VIEW, Uri.parse(liveUrl))
                                            )
                                        },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(12.dp),
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                                    ) {
                                        Icon(Icons.Default.Rocket, contentDescription = null, tint = VibePurple, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text(stringResource(R.string.open), color = VibePurple, maxLines = 1)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            clipboardManager.setText(AnnotatedString(liveUrl))
                                        },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(12.dp),
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                                    ) {
                                        Icon(Icons.Default.ContentCopy, contentDescription = null, tint = VibePurple, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text(stringResource(R.string.copy), color = VibePurple, maxLines = 1)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            val sendIntent = Intent().apply {
                                                action = Intent.ACTION_SEND
                                                putExtra(Intent.EXTRA_TEXT, shareText)
                                                type = "text/plain"
                                            }
                                            context.startActivity(Intent.createChooser(sendIntent, shareTitle))
                                        },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(12.dp),
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                                    ) {
                                        Icon(Icons.Default.Share, contentDescription = null, tint = VibePurple, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text(stringResource(R.string.share), color = VibePurple, maxLines = 1)
                                    }
                                }
                            }
                        }
                    } else {
                        // Not deployed — show deploy button
                        Button(
                            onClick = {
                                subdomainInput = project.title.lowercase()
                                    .replace(Regex("[^a-z0-9]+"), "-")
                                    .trim('-')
                                    .take(30)
                                viewModel.showDeployDialog()
                            },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = VibeBlue),
                            contentPadding = PaddingValues(vertical = 16.dp),
                            enabled = !uiState.isDeploying
                        ) {
                            if (uiState.isDeploying) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    color = TextPrimary,
                                    strokeWidth = 2.dp
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(stringResource(R.string.project_detail_btn_deploying), fontWeight = FontWeight.SemiBold)
                            } else {
                                Icon(Icons.Default.Rocket, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(stringResource(R.string.project_detail_btn_deploy_to_web), fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    // Export APK button
                    Button(
                        onClick = { viewModel.exportApk() },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = VibeGreen),
                        contentPadding = PaddingValues(vertical = 16.dp),
                        enabled = !uiState.isExportingApk
                    ) {
                        if (uiState.isExportingApk) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = TextPrimary,
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = uiState.apkExportProgress.ifEmpty { "Building APK..." },
                                fontWeight = FontWeight.SemiBold
                            )
                        } else {
                            Icon(Icons.Default.PhoneAndroid, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Export Android App", fontWeight = FontWeight.SemiBold)
                        }
                    }

                    // Preview on iPhone (via Expo Go) — only for deployed apps
                    if (liveUrl != null) {
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedButton(
                            onClick = {
                                val appTitle = project.title
                                    .replace(Regex("[^a-zA-Z0-9 ]"), "")
                                    .trim().take(30)
                                    .ifBlank { "My App" }
                                val code = "import React from 'react';import {WebView} from 'react-native-webview';export default ()=> <WebView source={{uri:'${liveUrl}'}} style={{flex:1}}/>;"
                                val encodedCode = java.net.URLEncoder.encode(code, "UTF-8")
                                val encodedName = java.net.URLEncoder.encode(appTitle, "UTF-8")
                                val snackUrl = "https://snack.expo.dev?platform=mydevice&name=$encodedName&dependencies=react-native-webview&code=$encodedCode&hideQueryParams=true"
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(snackUrl)))
                            },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, VibePurple),
                            contentPadding = PaddingValues(vertical = 16.dp)
                        ) {
                            Text("\uD83C\uDF4E", style = MaterialTheme.typography.titleMedium)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Preview on iPhone (Expo Go)", color = VibePurple, fontWeight = FontWeight.SemiBold)
                        }
                    }

                    // Stats
                    Spacer(modifier = Modifier.height(24.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        StatItem(stringResource(R.string.project_detail_stat_views), project.viewCount.toString())
                        StatItem(stringResource(R.string.project_detail_stat_forks), project.forkCount.toString())
                        StatItem(stringResource(R.string.project_detail_stat_tweaks), project.tweakCount.toString())
                    }

                    // Monetization card (only for deployed apps)
                    if (liveUrl != null) {
                        Spacer(modifier = Modifier.height(24.dp))
                        Card(
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant)
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            Icons.Default.TrendingUp,
                                            contentDescription = null,
                                            tint = TextTertiary,
                                            modifier = Modifier.size(20.dp)
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            "Monetization",
                                            style = MaterialTheme.typography.titleSmall,
                                            color = TextPrimary,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                    Surface(
                                        color = VibePurple.copy(alpha = 0.15f),
                                        shape = RoundedCornerShape(8.dp)
                                    ) {
                                        Text(
                                            "Coming Soon",
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = VibePurple,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                }
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "Earn revenue from ads shown on your deployed app. Ad monetization is currently under review and will be available soon.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextTertiary
                                )
                            }
                        }
                    }

                    // Prompt
                    if (!project.initialPrompt.isNullOrBlank()) {
                        Spacer(modifier = Modifier.height(24.dp))
                        Text(
                            text = stringResource(R.string.project_detail_section_original_prompt),
                            style = MaterialTheme.typography.titleMedium,
                            color = TextPrimary,
                            fontWeight = FontWeight.SemiBold
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Card(
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant)
                        ) {
                            Text(
                                text = project.initialPrompt,
                                modifier = Modifier.padding(16.dp),
                                style = MaterialTheme.typography.bodyMedium,
                                color = TextSecondary
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatItem(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            color = TextPrimary,
            fontWeight = FontWeight.Bold
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = TextTertiary
        )
    }
}
