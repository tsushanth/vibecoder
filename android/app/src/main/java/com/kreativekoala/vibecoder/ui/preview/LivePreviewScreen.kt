package com.kreativekoala.vibecoder.ui.preview

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Publish
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.*
import com.kreativekoala.vibecoder.util.rememberSpeechRecognizer
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LivePreviewScreen(
    bundleDir: File? = null,
    previewUrl: String? = null,
    onClose: () -> Unit,
    onSave: () -> Unit,
    onPublish: () -> Unit,
    isSaving: Boolean,
    isSaved: Boolean,
    isDeploying: Boolean,
    deployedUrl: String?,
    showDeployDialog: Boolean,
    onDeployConfirm: (String) -> Unit,
    onDeployDismiss: () -> Unit,
    onTweak: (String) -> Unit = {},
    isTweaking: Boolean = false,
    tweakPhase: String = "",
    onFeedback: (String) -> Unit = {},
    feedbackSent: String? = null,
    versionNumber: Int = 0,
    onVersionHistoryClick: () -> Unit = {}
) {
    var reloadTrigger by remember { mutableIntStateOf(0) }
    var subdomain by remember { mutableStateOf("") }
    var tweakText by remember { mutableStateOf("") }
    var showTweakBar by remember { mutableStateOf(false) }
    val tweakFocusRequester = remember { FocusRequester() }
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current

    // Voice input
    val (_, launchSpeech) = rememberSpeechRecognizer { spokenText ->
        tweakText = spokenText
        showTweakBar = true
    }

    // Auto-focus tweak field when bar opens
    LaunchedEffect(showTweakBar) {
        if (showTweakBar) {
            tweakFocusRequester.requestFocus()
        }
    }

    // Collapse tweak bar when tweak finishes + force-reload the WebView so
    // the new bundle is fetched. WebView caches HTML aggressively; without
    // a manual reload it keeps showing the pre-tweak content even though
    // the server has redeployed.
    var wasTweaking by remember { mutableStateOf(false) }
    LaunchedEffect(isTweaking) {
        if (isTweaking) {
            wasTweaking = true
        } else if (wasTweaking) {
            // tweak just transitioned true → false: success path.
            wasTweaking = false
            reloadTrigger++
            if (showTweakBar && tweakText.isBlank()) {
                showTweakBar = false
            }
        }
    }

    // Post-publish celebration sheet — only fires when deploy transitions null→non-null
    val deployedUrlAtEntry = remember { deployedUrl }
    var showPublishSheet by remember { mutableStateOf(false) }
    LaunchedEffect(deployedUrl) {
        if (deployedUrl != null && deployedUrlAtEntry == null) {
            showPublishSheet = true
        }
    }

    if (showPublishSheet && deployedUrl != null) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { showPublishSheet = false },
            sheetState = sheetState,
            containerColor = DarkSurfaceElevated
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "🎉",
                    style = MaterialTheme.typography.displaySmall
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.publish_sheet_title),
                    style = MaterialTheme.typography.headlineSmall,
                    color = TextPrimary,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = deployedUrl,
                    style = MaterialTheme.typography.bodyMedium,
                    color = VibePurple
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.publish_sheet_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
                Spacer(modifier = Modifier.height(24.dp))

                // Open in Browser
                Button(
                    onClick = {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(deployedUrl)))
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                    contentPadding = PaddingValues(vertical = 14.dp)
                ) {
                    Icon(Icons.Default.OpenInBrowser, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(R.string.publish_sheet_open_browser), fontWeight = FontWeight.SemiBold)
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Share
                val shareText = stringResource(R.string.publish_sheet_share_text, deployedUrl)
                val shareLabel = stringResource(R.string.share)
                OutlinedButton(
                    onClick = {
                        val intent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, shareText)
                        }
                        context.startActivity(Intent.createChooser(intent, shareLabel))
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, VibePurple),
                    contentPadding = PaddingValues(vertical = 14.dp)
                ) {
                    Icon(Icons.Default.Share, contentDescription = null, tint = VibePurple, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(R.string.publish_sheet_share), color = VibePurple, fontWeight = FontWeight.SemiBold)
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Monetize CTA (coming soon)
                OutlinedButton(
                    onClick = { /* Monetization coming soon */ },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, VibeGreen.copy(alpha = 0.5f)),
                    contentPadding = PaddingValues(vertical = 14.dp),
                    enabled = false
                ) {
                    Icon(Icons.Default.TrendingUp, contentDescription = null, tint = VibeGreen.copy(alpha = 0.5f), modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Monetize (Coming Soon)", color = VibeGreen.copy(alpha = 0.5f), fontWeight = FontWeight.SemiBold)
                }

                Spacer(modifier = Modifier.height(16.dp))

                TextButton(onClick = { showPublishSheet = false }) {
                    Text(stringResource(R.string.publish_sheet_done), color = TextSecondary)
                }
            }
        }
    }

    // Deploy subdomain dialog
    if (showDeployDialog) {
        AlertDialog(
            onDismissRequest = onDeployDismiss,
            title = { Text(stringResource(R.string.preview_deploy_dialog_title), color = TextPrimary) },
            text = {
                Column {
                    Text(
                        stringResource(R.string.preview_deploy_dialog_message),
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = subdomain,
                        onValueChange = { subdomain = it.lowercase().filter { c -> c.isLetterOrDigit() || c == '-' } },
                        placeholder = { Text(stringResource(R.string.preview_deploy_placeholder), color = TextTertiary) },
                        suffix = { Text(stringResource(R.string.preview_deploy_domain_suffix), color = TextSecondary) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = VibePurple,
                            unfocusedBorderColor = DarkBorder,
                            focusedContainerColor = DarkSurfaceVariant,
                            unfocusedContainerColor = DarkSurfaceVariant,
                            cursorColor = VibePurple,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary
                        ),
                        shape = RoundedCornerShape(12.dp)
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { onDeployConfirm(subdomain) },
                    enabled = subdomain.length >= 3,
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple)
                ) {
                    Text(stringResource(R.string.publish))
                }
            },
            dismissButton = {
                TextButton(onClick = onDeployDismiss) {
                    Text(stringResource(R.string.cancel), color = TextSecondary)
                }
            },
            containerColor = DarkSurfaceElevated
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .statusBarsPadding()
    ) {
        // Top bar
        TopAppBar(
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = stringResource(R.string.preview_screen_title),
                        fontWeight = FontWeight.SemiBold
                    )
                    if (versionNumber > 0) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Surface(
                            color = VibePurple.copy(alpha = 0.2f),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.clickable { onVersionHistoryClick() }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "v$versionNumber",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = VibePurple,
                                    fontWeight = FontWeight.Bold
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Icon(
                                    Icons.Default.History,
                                    contentDescription = stringResource(R.string.version_history),
                                    tint = VibePurple,
                                    modifier = Modifier.size(14.dp)
                                )
                            }
                        }
                    }
                }
            },
            navigationIcon = {
                IconButton(onClick = onClose) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = stringResource(R.string.close),
                        tint = TextPrimary
                    )
                }
            },
            actions = {
                IconButton(onClick = { reloadTrigger++ }) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = stringResource(R.string.reload),
                        tint = TextPrimary
                    )
                }

                if (isSaved) {
                    IconButton(onClick = {}, enabled = false) {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = stringResource(R.string.saved),
                            tint = SuccessGreen
                        )
                    }
                } else {
                    IconButton(
                        onClick = onSave,
                        enabled = !isSaving
                    ) {
                        if (isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = VibePurple,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(
                                Icons.Default.Save,
                                contentDescription = stringResource(R.string.save),
                                tint = VibePurple
                            )
                        }
                    }
                }

                // Publish button
                IconButton(
                    onClick = onPublish,
                    enabled = !isDeploying && deployedUrl == null
                ) {
                    if (isDeploying) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = VibeGreen,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            Icons.Default.Publish,
                            contentDescription = stringResource(R.string.publish),
                            tint = if (deployedUrl != null) SuccessGreen else VibeGreen
                        )
                    }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = DarkSurface,
                titleContentColor = TextPrimary
            )
        )

        // Deployed URL banner
        if (deployedUrl != null) {
            Surface(
                color = VibeGreen.copy(alpha = 0.15f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = stringResource(R.string.live),
                            color = VibeGreen,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = deployedUrl,
                            color = TextPrimary,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Row {
                        IconButton(
                            onClick = {
                                clipboardManager.setText(AnnotatedString(deployedUrl))
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(Icons.Default.ContentCopy, stringResource(R.string.copy), tint = TextSecondary, modifier = Modifier.size(18.dp))
                        }
                        IconButton(
                            onClick = {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(deployedUrl)))
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(Icons.Default.OpenInBrowser, stringResource(R.string.open), tint = TextSecondary, modifier = Modifier.size(18.dp))
                        }
                        val shareText = stringResource(R.string.preview_share_text, deployedUrl)
                        val shareLabel = stringResource(R.string.share)
                        IconButton(
                            onClick = {
                                val intent = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, shareText)
                                }
                                context.startActivity(Intent.createChooser(intent, shareLabel))
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(Icons.Default.Share, stringResource(R.string.share), tint = TextSecondary, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }

        // Feedback row
        Surface(
            color = DarkSurface,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (feedbackSent != null) "Thanks for your feedback!" else "How's this?",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = { onFeedback("up") },
                    enabled = feedbackSent == null,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        if (feedbackSent == "up") Icons.Filled.ThumbUp else Icons.Outlined.ThumbUp,
                        contentDescription = "Thumbs up",
                        tint = if (feedbackSent == "up") SuccessGreen else TextSecondary,
                        modifier = Modifier.size(20.dp)
                    )
                }
                IconButton(
                    onClick = { onFeedback("down") },
                    enabled = feedbackSent == null,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        if (feedbackSent == "down") Icons.Filled.ThumbDown else Icons.Outlined.ThumbDown,
                        contentDescription = "Thumbs down",
                        tint = if (feedbackSent == "down") Color(0xFFEF5350) else TextSecondary,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }

        // WebView — use URL if available, fall back to local file
        if (previewUrl != null) {
            UrlWebViewComposable(
                url = previewUrl,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                reloadTrigger = reloadTrigger
            )
        } else if (bundleDir != null) {
            WebViewComposable(
                bundleDir = bundleDir,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                reloadTrigger = reloadTrigger
            )
        }

        // Bottom area: either expanded tweak bar or collapsed "Improve" FAB
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .imePadding()
                .animateContentSize()
        ) {
            if (showTweakBar || isTweaking) {
                Surface(
                    color = DarkSurface,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column {
                        // Phase text during tweak
                        if (isTweaking && tweakPhase.isNotEmpty()) {
                            Text(
                                text = tweakPhase,
                                style = MaterialTheme.typography.labelSmall,
                                color = VibePurple,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                            )
                        }

                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = tweakText,
                                onValueChange = { tweakText = it },
                                modifier = Modifier
                                    .weight(1f)
                                    .focusRequester(tweakFocusRequester),
                                placeholder = {
                                    Text("What would you like to change?", color = TextTertiary)
                                },
                                enabled = !isTweaking,
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = VibePurple,
                                    unfocusedBorderColor = DarkBorder,
                                    focusedContainerColor = DarkSurfaceVariant,
                                    unfocusedContainerColor = DarkSurfaceVariant,
                                    cursorColor = VibePurple,
                                    focusedTextColor = TextPrimary,
                                    unfocusedTextColor = TextPrimary
                                ),
                                shape = RoundedCornerShape(24.dp)
                            )

                            Spacer(modifier = Modifier.width(4.dp))

                            if (isTweaking) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(40.dp),
                                    color = VibePurple,
                                    strokeWidth = 3.dp
                                )
                            } else {
                                // Mic button
                                IconButton(
                                    onClick = { launchSpeech() },
                                    modifier = Modifier.size(40.dp)
                                ) {
                                    Icon(
                                        Icons.Default.Mic,
                                        contentDescription = stringResource(R.string.create_cd_voice_input),
                                        tint = TextSecondary
                                    )
                                }

                                // Send button
                                IconButton(
                                    onClick = {
                                        onTweak(tweakText)
                                        tweakText = ""
                                    },
                                    enabled = tweakText.isNotBlank(),
                                    modifier = Modifier.size(40.dp)
                                ) {
                                    Icon(
                                        Icons.Default.Send,
                                        contentDescription = "Send tweak",
                                        tint = if (tweakText.isNotBlank()) VibePurple else TextTertiary
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                // "Improve" FAB — shown when tweak bar is collapsed
                FloatingActionButton(
                    onClick = { showTweakBar = true },
                    containerColor = VibePurple,
                    shape = CircleShape,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(16.dp)
                ) {
                    Icon(
                        Icons.Default.Edit,
                        contentDescription = "Improve this app",
                        tint = Color.White
                    )
                }
            }
        }
    }
}
