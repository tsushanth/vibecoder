package com.kreativekoala.vibecoder.ui.apps.keys

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.*

/**
 * "App keys" card on a project: the keys the generated app needs (third-party APIs, Stripe) and whether each is set. A value is typed
 * into a password field, sent once, and never shown again. While a field is on screen the window blocks screenshots.
 */
@Composable
fun AppKeysSection(projectId: String, modifier: Modifier = Modifier, viewModel: AppKeysViewModel = hiltViewModel()) {
    val c = viewModel.controller
    val s by c.state.collectAsState()
    LaunchedEffect(projectId) { c.load(projectId) }

    when (s.load) {
        KeysLoad.LOADING, KeysLoad.HIDDEN -> return
        KeysLoad.ERROR -> {
            KeysCard(modifier) {
                Text(stringResource(R.string.app_keys_title), style = MaterialTheme.typography.titleSmall, color = TextPrimary, fontWeight = FontWeight.SemiBold)
                s.error?.let { Text(errorText(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                OutlinedButton(onClick = { c.retry() }, shape = RoundedCornerShape(10.dp)) { Text(stringResource(R.string.app_keys_retry)) }
            }
            return
        }
        KeysLoad.READY -> Unit
    }

    // open by default while something is missing, so a creator sees what the app needs
    var expanded by rememberSaveable(projectId) { mutableStateOf(s.missing > 0) }
    // a value can only be on screen while the card is open and a field is showing
    val anyField = expanded && s.rows.any { !it.isSet || s.replacing == it.name }
    SecureWindowEffect(enabled = anyField)
    DisposableEffect(Unit) { onDispose { c.clearDrafts() } }

    KeysCard(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.app_keys_title), style = MaterialTheme.typography.titleSmall, color = TextPrimary, fontWeight = FontWeight.SemiBold)
                Text(
                    if (s.missing == 0) stringResource(R.string.app_keys_summary_all_set, s.total)
                    else stringResource(R.string.app_keys_summary, s.total - s.missing, s.total),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (s.missing == 0) VibeGreen else TextSecondary
                )
            }
            TextButton(onClick = { expanded = !expanded }) {
                Text(stringResource(if (expanded) R.string.app_keys_hide else R.string.app_keys_manage), color = VibePurple)
            }
        }
        if (expanded) {
            Text(stringResource(R.string.app_keys_hint), style = MaterialTheme.typography.bodySmall, color = TextSecondary)
            if (s.hasPay) PayHints(s.payWebhookUrl)
            s.rows.forEach { row -> KeyRowView(row, s, c) }
            s.error?.let { Text(errorText(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }

    s.confirmingRemove?.let { name ->
        AlertDialog(
            onDismissRequest = { c.cancelRemove() },
            title = { Text(stringResource(R.string.app_keys_remove_title, name)) },
            text = { Text(stringResource(R.string.app_keys_remove_message)) },
            confirmButton = {
                TextButton(onClick = { c.confirmRemove(name) }, enabled = s.busy == null) {
                    Text(stringResource(R.string.app_keys_remove), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { c.cancelRemove() }) { Text(stringResource(R.string.cancel)) } },
            containerColor = DarkSurfaceVariant
        )
    }
}

@Composable
private fun KeysCard(modifier: Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, DarkBorder),
        colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant),
        modifier = modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

@Composable
private fun KeyRowView(row: KeyRow, s: AppKeysState, c: AppKeysController) {
    val busyHere = s.busy == row.name
    val editing = !row.isSet || s.replacing == row.name
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(row.name, color = TextPrimary, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                if (row.usedBy.isNotEmpty()) {
                    Text(stringResource(R.string.app_keys_used_by, row.usedBy.joinToString(", ")), style = MaterialTheme.typography.labelSmall, color = TextTertiary)
                }
            }
            Text(
                stringResource(if (row.isSet) R.string.app_keys_set else R.string.app_keys_not_set),
                style = MaterialTheme.typography.labelMedium,
                color = if (row.isSet) VibeGreen else TextSecondary,
                fontWeight = FontWeight.SemiBold
            )
        }
        row.purpose?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = TextSecondary) }
        if (editing) {
            OutlinedTextField(
                value = s.drafts[row.name].orEmpty(),
                onValueChange = { c.onDraftChanged(row.name, it) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                enabled = s.busy == null,
                label = { Text(stringResource(R.string.app_keys_input_label, row.name)) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = VibePurple, cursorColor = VibePurple)
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { c.save(row.name) },
                    enabled = s.busy == null && s.drafts[row.name].orEmpty().isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                    shape = RoundedCornerShape(10.dp)
                ) { Text(stringResource(if (busyHere) R.string.app_keys_saving else R.string.app_keys_save)) }
                if (row.isSet) {
                    TextButton(onClick = { c.cancelEdit(row.name) }, enabled = s.busy == null) { Text(stringResource(R.string.cancel)) }
                }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onClick = { c.startReplace(row.name) }, enabled = s.busy == null, shape = RoundedCornerShape(10.dp)) {
                    Text(stringResource(R.string.app_keys_replace))
                }
                TextButton(onClick = { c.askRemove(row.name) }, enabled = s.busy == null) {
                    Text(stringResource(if (busyHere) R.string.app_keys_removing else R.string.app_keys_remove), color = MaterialTheme.colorScheme.error)
                }
                val note = s.note
                if (note != null && note.name == row.name) {
                    Text(
                        stringResource(if (note.kind == KeyNoteKind.SAVED) R.string.app_keys_saved else R.string.app_keys_removed),
                        style = MaterialTheme.typography.labelMedium, color = VibeGreen
                    )
                }
            }
        }
    }
}

@Composable
private fun PayHints(webhookUrl: String?) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.app_keys_pay_test_first), style = MaterialTheme.typography.bodySmall, color = TextPrimary)
        Text(stringResource(R.string.app_keys_pay_webhook_label), style = MaterialTheme.typography.labelSmall, color = TextTertiary)
        if (webhookUrl != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(webhookUrl, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = TextSecondary, fontFamily = FontFamily.Monospace)
                OutlinedButton(onClick = { clipboard.setText(AnnotatedString(webhookUrl)); copied = true }, shape = RoundedCornerShape(10.dp)) {
                    Text(stringResource(if (copied) R.string.app_keys_copied else R.string.app_keys_copy_url))
                }
            }
        } else {
            Text(stringResource(R.string.app_keys_pay_webhook_pending), style = MaterialTheme.typography.labelSmall, color = TextSecondary)
        }
    }
}

@Composable
private fun errorText(e: KeysError) = stringResource(
    when (e) {
        KeysError.UNAUTHORIZED -> R.string.app_keys_error_unauthorized
        KeysError.RATE_LIMITED -> R.string.app_keys_error_rate_limited
        KeysError.STORE_DOWN -> R.string.app_keys_error_store_down
        KeysError.INVALID_VALUE -> R.string.app_keys_error_invalid_value
        KeysError.NETWORK -> R.string.app_keys_error_network
        KeysError.FORBIDDEN, KeysError.OTHER -> R.string.app_keys_error_other
    }
)

/** Blocks screenshots, screen recording and the recents thumbnail of this window while [enabled], and restores it after. */
@Composable
private fun SecureWindowEffect(enabled: Boolean) {
    val activity = LocalContext.current.findActivity()
    DisposableEffect(activity, enabled) {
        val window = activity?.window
        val hadFlag = window != null && (window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE) != 0
        if (enabled && window != null && !hadFlag) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { if (enabled && window != null && !hadFlag) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
