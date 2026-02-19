package com.kreativekoala.vibecoder.ui.preview

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
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
    isSaving: Boolean,
    isSaved: Boolean
) {
    var reloadTrigger by remember { mutableIntStateOf(0) }

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
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = DarkSurface,
                titleContentColor = TextPrimary
            )
        )

        // WebView
        WebViewComposable(
            bundleDir = bundleDir,
            modifier = Modifier.fillMaxSize(),
            onReloadRequested = if (reloadTrigger > 0) ({}) else null
        )
    }
}
