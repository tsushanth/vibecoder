package com.kreativekoala.vibecoder.ui.create

import android.app.Activity
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.play.core.review.ReviewManagerFactory
import com.kreativekoala.vibecoder.MainActivity
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.preview.LivePreviewScreen
import com.kreativekoala.vibecoder.ui.theme.*

@Composable
fun CreateScreen(
    modifier: Modifier = Modifier,
    onNavigateToSubscriptions: () -> Unit = {},
    onNavigateToHardPaywall: () -> Unit = {},
    viewModel: CreateViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    // Triggered when startGeneration() blocks the free-build cap. Navigates to
    // the non-dismissible paywall and immediately clears the flag — if the user
    // comes back without purchasing, the next generation attempt re-blocks and
    // re-fires this navigation.
    LaunchedEffect(uiState.showHardPaywall) {
        if (uiState.showHardPaywall) {
            onNavigateToHardPaywall()
            viewModel.onPaywallPurchaseSuccess()
        }
    }

    // No longer forcing screen on — if connection drops, we poll for the result

    var showSaveSuccess by remember { mutableStateOf(false) }
    var ratingStep by remember { mutableIntStateOf(0) } // 0 = hidden, 1 = "enjoying?", 2 = "contact support?"

    // Trigger rating dialog when ViewModel signals it
    LaunchedEffect(uiState.showRatingPrompt) {
        if (uiState.showRatingPrompt) {
            ratingStep = 1
        }
    }

    // Two-step rating dialog
    if (ratingStep == 1) {
        AlertDialog(
            onDismissRequest = {
                ratingStep = 0
                viewModel.dismissRatingPrompt()
            },
            title = { Text("Enjoying VibeBuild?", color = TextPrimary) },
            text = { Text("We'd love to hear what you think!", color = TextSecondary) },
            confirmButton = {
                TextButton(onClick = {
                    ratingStep = 0
                    viewModel.dismissRatingPrompt()
                    val activity = context as? Activity ?: return@TextButton
                    val manager = ReviewManagerFactory.create(activity)
                    manager.requestReviewFlow().addOnCompleteListener { request ->
                        if (request.isSuccessful) {
                            manager.launchReviewFlow(activity, request.result)
                        }
                    }
                }) {
                    Text("Yes!", color = VibePurple)
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    ratingStep = 2
                    viewModel.dismissRatingPrompt()
                }) {
                    Text("Not really", color = TextSecondary)
                }
            },
            containerColor = DarkSurfaceVariant
        )
    }

    if (ratingStep == 2) {
        AlertDialog(
            onDismissRequest = { ratingStep = 0 },
            title = { Text("We're sorry to hear that", color = TextPrimary) },
            text = { Text("Would you like to contact our support team?", color = TextSecondary) },
            confirmButton = {
                TextButton(onClick = {
                    ratingStep = 0
                    val intent = Intent(Intent.ACTION_SENDTO).apply {
                        data = Uri.parse("mailto:support@kreativekoala.llc")
                        putExtra(Intent.EXTRA_SUBJECT, "VibeBuild Feedback")
                    }
                    try { context.startActivity(intent) } catch (_: Exception) {}
                }) {
                    Text("Contact Support", color = VibePurple)
                }
            },
            dismissButton = {
                TextButton(onClick = { ratingStep = 0 }) {
                    Text("No thanks", color = TextSecondary)
                }
            },
            containerColor = DarkSurfaceVariant
        )
    }

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
    var showClosePublishPrompt by remember { mutableStateOf(false) }

    if (uiState.showPreview && uiState.bundleDir != null) {
        Box(modifier = Modifier.fillMaxSize()) {
            LivePreviewScreen(
                bundleDir = uiState.bundleDir!!,
                onClose = {
                    // If already published or saved, just close
                    if (uiState.deployedUrl != null || uiState.savedProjectId != null) {
                        viewModel.dismissPreview()
                    } else {
                        // Not saved or published — ask if they want to save/publish first
                        showClosePublishPrompt = true
                    }
                },
                onSave = { viewModel.saveProject() },
                onPublish = { viewModel.showDeployDialog() },
                isSaving = uiState.isSaving,
                isSaved = uiState.savedProjectId != null,
                isDeploying = uiState.isDeploying,
                deployedUrl = uiState.deployedUrl,
                showDeployDialog = uiState.showDeployDialog,
                onDeployConfirm = { subdomain -> viewModel.publishProject(subdomain) },
                onDeployDismiss = { viewModel.dismissDeployDialog() },
                onTweak = { desc -> viewModel.tweakProject(desc) },
                isTweaking = uiState.isTweaking,
                tweakPhase = uiState.tweakPhase,
                onFeedback = { rating -> viewModel.sendFeedback(rating) },
                feedbackSent = uiState.feedbackSent,
                versionNumber = uiState.versionNumber
            )

            if (showSaveSuccess && uiState.deployedUrl == null) {
                AlertDialog(
                    onDismissRequest = { showSaveSuccess = false },
                    title = { Text(stringResource(R.string.create_save_dialog_title)) },
                    text = { Text(stringResource(R.string.create_save_dialog_message)) },
                    confirmButton = {
                        TextButton(onClick = { showSaveSuccess = false }) {
                            Text(stringResource(R.string.ok), color = VibePurple)
                        }
                    },
                    containerColor = DarkSurfaceVariant
                )
            }

            // Prompt to save before closing
            if (showClosePublishPrompt) {
                AlertDialog(
                    onDismissRequest = { showClosePublishPrompt = false },
                    title = { Text("Save your app?", color = TextPrimary) },
                    text = { Text("Your app hasn't been saved yet. Would you like to save it before closing?", color = TextSecondary) },
                    confirmButton = {
                        TextButton(onClick = {
                            showClosePublishPrompt = false
                            viewModel.saveProject()
                        }) {
                            Text("Save", color = VibePurple)
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = {
                            showClosePublishPrompt = false
                            viewModel.dismissPreview()
                        }) {
                            Text("Discard", color = TextSecondary)
                        }
                    },
                    containerColor = DarkSurfaceVariant
                )
            }
        }
        return
    }

    // Building confirmation dialog — with upsell on 2nd generation for free users
    if (uiState.showBuildingConfirmation) {
        val generationCount = remember { MainActivity.getGenerationCount(context) }
        val isPremium = MainActivity.isPremiumUser(context)
        val isLastFree = !isPremium && generationCount >= MainActivity.FREE_GENERATION_LIMIT - 1

        AlertDialog(
            onDismissRequest = { viewModel.dismissBuildingConfirmation() },
            title = { Text("Your app is being built! 🎉", color = TextPrimary) },
            text = {
                Column {
                    Text("We'll notify you when it's ready. Check My Projects in about 5 minutes.", color = TextSecondary)
                    if (isLastFree) {
                        Spacer(Modifier.height(12.dp))
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF6366F1).copy(alpha = 0.15f)),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Text("⚡ This is your last free build", color = Color(0xFF818CF8), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                Spacer(Modifier.height(4.dp))
                                Text("Upgrade to Pro for unlimited apps, priority builds, and no wait times.", color = TextSecondary, fontSize = 12.sp)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                if (isLastFree) {
                    Button(
                        onClick = { viewModel.dismissBuildingConfirmation(); onNavigateToSubscriptions() },
                        colors = ButtonDefaults.buttonColors(containerColor = VibePurple)
                    ) { Text("Upgrade to Pro") }
                } else {
                    TextButton(onClick = { viewModel.dismissBuildingConfirmation() }) {
                        Text("Got it", color = VibePurple)
                    }
                }
            },
            dismissButton = if (isLastFree) {
                { TextButton(onClick = { viewModel.dismissBuildingConfirmation() }) { Text("Later", color = TextSecondary) } }
            } else null,
            containerColor = DarkSurfaceVariant
        )
    }

    // Error snackbar
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

    if (uiState.showSystemBusyDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissSystemBusyDialog() },
            title = { Text("🔥 High Demand Right Now") },
            text = {
                Text("Our builders are at full capacity. Pro users get priority access and build instantly.")
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.dismissSystemBusyDialog()
                    onNavigateToSubscriptions()
                }) {
                    Text("⚡ Upgrade to Pro", color = VibePurple)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissSystemBusyDialog() }) {
                    Text(stringResource(R.string.ok))
                }
            },
            containerColor = DarkSurfaceVariant
        )
    }

    Box(modifier = modifier.fillMaxSize()) {
        // Input mode (generation runs in background — no progress screen)
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
                    text = stringResource(R.string.create_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = TextPrimary,
                    fontWeight = FontWeight.Bold
                )

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = stringResource(R.string.create_subtitle),
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
                            text = stringResource(R.string.create_prompt_placeholder),
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
                                contentDescription = stringResource(R.string.create_cd_reference_image),
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
                                contentDescription = stringResource(R.string.create_cd_remove_image),
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
                                contentDescription = stringResource(R.string.create_cd_attach_image),
                                tint = TextSecondary
                            )
                        }

                        // Mic button (placeholder for Phase 3)
                        IconButton(onClick = { /* Phase 3 */ }) {
                            Icon(
                                Icons.Default.Mic,
                                contentDescription = stringResource(R.string.create_cd_voice_input),
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
                            text = stringResource(R.string.start_generating),
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Templates: curated starter projects (same 30 the iOS catalog
                // ships). Tapping one seeds the prompt with its description.
                if (uiState.templates.isNotEmpty()) {
                    TemplateRow(
                        templates = uiState.templates,
                        onTemplateClick = { viewModel.selectTemplate(it) }
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                }

                // Suggestion chips
                SuggestionChips(
                    suggestions = uiState.suggestions,
                    onSuggestionClick = { suggestion ->
                        viewModel.updatePrompt(suggestion.prompt)
                    },
                    isLoadingSuggestions = uiState.isLoadingSuggestions,
                    onSuggestNewIdeas = { viewModel.suggestNewIdeas() }
                )

                Spacer(modifier = Modifier.height(32.dp))
            }
    }
}
