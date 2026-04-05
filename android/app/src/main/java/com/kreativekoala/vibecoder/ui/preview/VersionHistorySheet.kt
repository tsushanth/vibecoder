package com.kreativekoala.vibecoder.ui.preview

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.data.model.AppVersion
import com.kreativekoala.vibecoder.ui.theme.*
import com.kreativekoala.vibecoder.util.DateUtil

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VersionHistorySheet(
    versions: List<AppVersion>,
    isLoading: Boolean,
    isReverting: Boolean,
    onUseVersion: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var confirmRevertSha by remember { mutableStateOf<String?>(null) }

    // Confirmation dialog
    if (confirmRevertSha != null) {
        AlertDialog(
            onDismissRequest = { confirmRevertSha = null },
            title = { Text(stringResource(R.string.version_use_title), color = TextPrimary) },
            text = {
                Text(
                    stringResource(R.string.version_use_message),
                    color = TextSecondary
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        onUseVersion(confirmRevertSha!!)
                        confirmRevertSha = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple)
                ) {
                    Text(stringResource(R.string.version_use_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmRevertSha = null }) {
                    Text(stringResource(R.string.cancel), color = TextSecondary)
                }
            },
            containerColor = DarkSurfaceElevated
        )
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = DarkSurfaceElevated
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.History,
                    contentDescription = null,
                    tint = VibePurple,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.version_history),
                    style = MaterialTheme.typography.titleLarge,
                    color = TextPrimary,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.version_history_subtitle),
                style = MaterialTheme.typography.bodySmall,
                color = TextTertiary
            )

            Spacer(modifier = Modifier.height(16.dp))

            when {
                isLoading -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(200.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(color = VibePurple)
                    }
                }

                isReverting -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(200.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(color = VibePurple)
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(
                                stringResource(R.string.version_restoring),
                                color = TextSecondary,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                }

                versions.isEmpty() -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(150.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            stringResource(R.string.version_empty),
                            color = TextTertiary,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }

                else -> {
                    LazyColumn(
                        modifier = Modifier.heightIn(max = 400.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        itemsIndexed(versions) { index, version ->
                            val versionNum = versions.size - index
                            val isCurrent = index == 0

                            Card(
                                shape = RoundedCornerShape(12.dp),
                                colors = CardDefaults.cardColors(
                                    containerColor = if (isCurrent)
                                        VibePurple.copy(alpha = 0.1f)
                                    else
                                        DarkSurfaceVariant
                                )
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    // Version number badge
                                    Surface(
                                        color = if (isCurrent) VibePurple else DarkBorder,
                                        shape = RoundedCornerShape(8.dp)
                                    ) {
                                        Text(
                                            text = "v$versionNum",
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                            style = MaterialTheme.typography.labelMedium,
                                            color = if (isCurrent) TextPrimary else TextSecondary,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }

                                    Spacer(modifier = Modifier.width(12.dp))

                                    // Description + date
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = formatVersionMessage(version.message),
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = TextPrimary,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            text = DateUtil.relativeTimeString(version.date),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = TextTertiary
                                        )
                                    }

                                    // Current badge or restore button
                                    if (isCurrent) {
                                        Surface(
                                            color = VibePurple,
                                            shape = RoundedCornerShape(8.dp)
                                        ) {
                                            Text(
                                                text = stringResource(R.string.version_current),
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = TextPrimary,
                                                fontWeight = FontWeight.SemiBold
                                            )
                                        }
                                    } else {
                                        IconButton(
                                            onClick = { confirmRevertSha = version.sha },
                                            modifier = Modifier.size(36.dp)
                                        ) {
                                            Icon(
                                                Icons.Default.Restore,
                                                contentDescription = stringResource(R.string.version_use_this),
                                                tint = VibePurple,
                                                modifier = Modifier.size(20.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun formatVersionMessage(message: String): String {
    // Clean up commit messages like "Tweak: Added dark mode" → "Added dark mode"
    return message
        .removePrefix("Tweak: ")
        .removePrefix("tweak: ")
        .removePrefix("Initial app creation")
        .ifBlank { "Initial version" }
}
