package com.kreativekoala.vibecoder.ui.preview

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Publish
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.vibecoder.ui.theme.*
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LivePreviewScreen(
    bundleDir: File,
    onClose: () -> Unit,
    onSave: () -> Unit,
    onPublish: () -> Unit,
    isSaving: Boolean,
    isSaved: Boolean,
    isDeploying: Boolean,
    deployedUrl: String?,
    showDeployDialog: Boolean,
    onDeployConfirm: (String) -> Unit,
    onDeployDismiss: () -> Unit
) {
    var reloadTrigger by remember { mutableIntStateOf(0) }
    var subdomain by remember { mutableStateOf("") }
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current

    // Deploy subdomain dialog
    if (showDeployDialog) {
        AlertDialog(
            onDismissRequest = onDeployDismiss,
            title = { Text("Publish Your App", color = TextPrimary) },
            text = {
                Column {
                    Text(
                        "Choose a subdomain for your app:",
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = subdomain,
                        onValueChange = { subdomain = it.lowercase().filter { c -> c.isLetterOrDigit() || c == '-' } },
                        placeholder = { Text("my-awesome-app", color = TextTertiary) },
                        suffix = { Text(".vibebuild.cc", color = TextSecondary) },
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
                    Text("Publish")
                }
            },
            dismissButton = {
                TextButton(onClick = onDeployDismiss) {
                    Text("Cancel", color = TextSecondary)
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
                Text(
                    text = "Preview",
                    fontWeight = FontWeight.SemiBold
                )
            },
            navigationIcon = {
                IconButton(onClick = onClose) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Close",
                        tint = TextPrimary
                    )
                }
            },
            actions = {
                IconButton(onClick = { reloadTrigger++ }) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = "Reload",
                        tint = TextPrimary
                    )
                }

                if (isSaved) {
                    IconButton(onClick = {}, enabled = false) {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = "Saved",
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
                                contentDescription = "Save",
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
                            contentDescription = "Publish",
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
                            text = "Live",
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
                            Icon(Icons.Default.ContentCopy, "Copy", tint = TextSecondary, modifier = Modifier.size(18.dp))
                        }
                        IconButton(
                            onClick = {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(deployedUrl)))
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(Icons.Default.OpenInBrowser, "Open", tint = TextSecondary, modifier = Modifier.size(18.dp))
                        }
                        IconButton(
                            onClick = {
                                val intent = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, "Check out my app: $deployedUrl")
                                }
                                context.startActivity(Intent.createChooser(intent, "Share"))
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(Icons.Default.Share, "Share", tint = TextSecondary, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }

        // WebView
        WebViewComposable(
            bundleDir = bundleDir,
            modifier = Modifier.fillMaxSize(),
            onReloadRequested = if (reloadTrigger > 0) ({}) else null
        )
    }
}
