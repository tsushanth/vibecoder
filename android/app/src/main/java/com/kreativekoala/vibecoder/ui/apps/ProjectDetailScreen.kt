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
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Rocket
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.ui.preview.LivePreviewScreen
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
        viewModel.checkDeployStatus()
    }

    // Deploy subdomain dialog
    if (uiState.showDeployDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissDeployDialog() },
            title = { Text("Deploy App") },
            text = {
                Column {
                    Text(
                        "Choose a subdomain for your app:",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = subdomainInput,
                        onValueChange = { subdomainInput = it.lowercase().replace(Regex("[^a-z0-9-]"), "") },
                        label = { Text("Subdomain") },
                        suffix = { Text(".vibebuild.cc", color = TextTertiary) },
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
                    Text("Deploy", color = if (subdomainInput.length >= 3) VibePurple else TextTertiary)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissDeployDialog() }) {
                    Text("Cancel")
                }
            },
            containerColor = DarkSurfaceVariant
        )
    }

    // Error dialog
    if (uiState.errorMessage != null) {
        AlertDialog(
            onDismissRequest = { viewModel.clearError() },
            title = { Text("Error") },
            text = { Text(uiState.errorMessage ?: "") },
            confirmButton = {
                TextButton(onClick = { viewModel.clearError() }) {
                    Text("OK", color = VibePurple)
                }
            },
            containerColor = DarkSurfaceVariant
        )
    }

    // Show preview
    if (uiState.showPreview && uiState.bundleDir != null) {
        LivePreviewScreen(
            bundleDir = uiState.bundleDir!!,
            onClose = { viewModel.hidePreview() },
            onSave = {},
            onPublish = {},
            isSaving = false,
            isSaved = true,
            isDeploying = false,
            deployedUrl = uiState.deployedUrl ?: uiState.project?.publishedUrl,
            showDeployDialog = false,
            onDeployConfirm = {},
            onDeployDismiss = {}
        )
        return
    }

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                title = { Text(uiState.project?.title ?: "Project") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
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
                        text = "Created ${DateUtil.relativeTimeString(project.createdAt)}",
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
                            Text("Preview App", fontWeight = FontWeight.SemiBold)
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
                                        "Deployed",
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
                                        shape = RoundedCornerShape(12.dp)
                                    ) {
                                        Icon(Icons.Default.Rocket, contentDescription = null, tint = VibePurple, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text("Open", color = VibePurple)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            clipboardManager.setText(AnnotatedString(liveUrl))
                                        },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(12.dp)
                                    ) {
                                        Icon(Icons.Default.ContentCopy, contentDescription = null, tint = VibePurple, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text("Copy", color = VibePurple)
                                    }
                                    OutlinedButton(
                                        onClick = {
                                            val sendIntent = Intent().apply {
                                                action = Intent.ACTION_SEND
                                                putExtra(Intent.EXTRA_TEXT, "Check out my app: $liveUrl")
                                                type = "text/plain"
                                            }
                                            context.startActivity(Intent.createChooser(sendIntent, "Share"))
                                        },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(12.dp)
                                    ) {
                                        Icon(Icons.Default.Share, contentDescription = null, tint = VibePurple, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text("Share", color = VibePurple)
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
                                Text("Deploying...", fontWeight = FontWeight.SemiBold)
                            } else {
                                Icon(Icons.Default.Rocket, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Deploy to Web", fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }

                    // Stats
                    Spacer(modifier = Modifier.height(24.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        StatItem("Views", project.viewCount.toString())
                        StatItem("Forks", project.forkCount.toString())
                        StatItem("Tweaks", project.tweakCount.toString())
                    }

                    // Prompt
                    if (!project.initialPrompt.isNullOrBlank()) {
                        Spacer(modifier = Modifier.height(24.dp))
                        Text(
                            text = "Original Prompt",
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
