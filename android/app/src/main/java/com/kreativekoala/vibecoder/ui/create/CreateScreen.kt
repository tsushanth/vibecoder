package com.kreativekoala.vibecoder.ui.create

import android.app.Activity
import android.graphics.BitmapFactory
import android.util.Base64
import android.view.WindowManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.ui.preview.LivePreviewScreen
import com.kreativekoala.vibecoder.ui.theme.*

@Composable
fun CreateScreen(
    modifier: Modifier = Modifier,
    viewModel: CreateViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    // Keep screen on during generation
    DisposableEffect(uiState.isGenerating) {
        val window = (context as? Activity)?.window
        if (uiState.isGenerating) {
            window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        onDispose {
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    var showSaveSuccess by remember { mutableStateOf(false) }

    // Image picker
    val imagePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        uri?.let {
            try {
                val inputStream = context.contentResolver.openInputStream(it)
                val bytes = inputStream?.readBytes()
                inputStream?.close()
                if (bytes != null) {
                    val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                    viewModel.setReferenceImage(base64)
                }
            } catch (_: Exception) {}
        }
    }

    // Show save success alert when project is saved
    LaunchedEffect(uiState.savedProjectId) {
        if (uiState.savedProjectId != null) {
            showSaveSuccess = true
        }
    }

    // Show preview overlay
    if (uiState.showPreview && uiState.bundleDir != null) {
        Box(modifier = Modifier.fillMaxSize()) {
            LivePreviewScreen(
                bundleDir = uiState.bundleDir!!,
                onClose = { viewModel.dismissPreview() },
                onSave = { viewModel.saveProject() },
                onPublish = { viewModel.showDeployDialog() },
                isSaving = uiState.isSaving,
                isSaved = uiState.savedProjectId != null,
                isDeploying = uiState.isDeploying,
                deployedUrl = uiState.deployedUrl,
                showDeployDialog = uiState.showDeployDialog,
                onDeployConfirm = { subdomain -> viewModel.publishProject(subdomain) },
                onDeployDismiss = { viewModel.dismissDeployDialog() }
            )

            if (showSaveSuccess && uiState.deployedUrl == null) {
                AlertDialog(
                    onDismissRequest = { showSaveSuccess = false },
                    title = { Text("Saved!") },
                    text = { Text("Your project has been saved. Tap the publish button to make it live!") },
                    confirmButton = {
                        TextButton(onClick = { showSaveSuccess = false }) {
                            Text("OK", color = VibePurple)
                        }
                    },
                    containerColor = DarkSurfaceVariant
                )
            }
        }
        return
    }

    // Error snackbar
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

    Box(modifier = modifier.fillMaxSize()) {
        if (uiState.isGenerating) {
            // Generation progress view
            GenerationProgressView(
                progressPercent = uiState.progressPercent,
                simulatedProgress = uiState.simulatedProgress,
                notifyEnabled = uiState.notifyEnabled,
                buildPhase = uiState.buildPhase,
                buildDetail = uiState.buildDetail,
                estimatedSecondsRemaining = uiState.estimatedSecondsRemaining,
                onNotifyEnabledChanged = { viewModel.setNotifyEnabled(it) },
                onSimulatedProgressChanged = { viewModel.updateSimulatedProgress(it) },
                onCancel = { viewModel.cancelGeneration() },
                modifier = Modifier.align(Alignment.Center)
            )
        } else {
            // Input mode
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
                    .statusBarsPadding()
            ) {
                Spacer(modifier = Modifier.height(16.dp))

                // Greeting
                Text(
                    text = "What do you want to make?",
                    style = MaterialTheme.typography.headlineMedium,
                    color = TextPrimary,
                    fontWeight = FontWeight.Bold
                )

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = "Describe your app idea and AI will build it",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary
                )

                Spacer(modifier = Modifier.height(24.dp))

                // Prompt input
                OutlinedTextField(
                    value = uiState.prompt,
                    onValueChange = { viewModel.updatePrompt(it) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 160.dp),
                    placeholder = {
                        Text(
                            text = "e.g., Build a weather app that shows the forecast for my city...",
                            color = TextTertiary
                        )
                    },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = VibePurple,
                        unfocusedBorderColor = DarkBorder,
                        focusedContainerColor = DarkSurfaceVariant,
                        unfocusedContainerColor = DarkSurfaceVariant,
                        cursorColor = VibePurple,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary
                    ),
                    shape = RoundedCornerShape(16.dp)
                )

                // Reference image preview
                if (uiState.referenceImageBase64 != null) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(120.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(DarkSurfaceVariant)
                    ) {
                        val bytes = Base64.decode(uiState.referenceImageBase64, Base64.DEFAULT)
                        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        if (bitmap != null) {
                            androidx.compose.foundation.Image(
                                bitmap = bitmap.asImageBitmap(),
                                contentDescription = "Reference image",
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Fit
                            )
                        }
                        IconButton(
                            onClick = { viewModel.setReferenceImage(null) },
                            modifier = Modifier.align(Alignment.TopEnd)
                        ) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Remove image",
                                tint = TextPrimary
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Action row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row {
                        // Attach image
                        IconButton(
                            onClick = { imagePickerLauncher.launch("image/*") }
                        ) {
                            Icon(
                                Icons.Default.AttachFile,
                                contentDescription = "Attach image",
                                tint = TextSecondary
                            )
                        }

                        // Mic button (placeholder for Phase 3)
                        IconButton(onClick = { /* Phase 3 */ }) {
                            Icon(
                                Icons.Default.Mic,
                                contentDescription = "Voice input",
                                tint = TextSecondary
                            )
                        }
                    }

                    // Generate button
                    Button(
                        onClick = { viewModel.startGeneration() },
                        enabled = uiState.prompt.isNotBlank(),
                        shape = RoundedCornerShape(24.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = VibePurple,
                            disabledContainerColor = VibePurple.copy(alpha = 0.3f)
                        ),
                        contentPadding = PaddingValues(horizontal = 32.dp, vertical = 12.dp)
                    ) {
                        Text(
                            text = "Start",
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Suggestion chips
                SuggestionChips(
                    suggestions = uiState.suggestions,
                    onSuggestionClick = { suggestion ->
                        viewModel.updatePrompt(suggestion.prompt)
                    }
                )

                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }
}
