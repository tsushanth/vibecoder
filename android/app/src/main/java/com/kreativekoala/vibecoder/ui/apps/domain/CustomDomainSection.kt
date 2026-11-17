package com.kreativekoala.vibecoder.ui.apps.domain

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.focus.onFocusEvent
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.kreativekoala.vibecoder.R
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.ui.theme.*

@Composable
fun CustomDomainSection(
    deploymentId: String,
    onUpgrade: () -> Unit,
    viewModel: CustomDomainViewModel = hiltViewModel()
) {
    val c = viewModel.controller
    val s by c.state.collectAsState()
    LaunchedEffect(deploymentId) { c.load(deploymentId) }

    Card(
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, DarkBorder),
        colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.custom_domain_title), style = MaterialTheme.typography.titleSmall, color = TextPrimary, fontWeight = FontWeight.SemiBold)
            when {
                s.work == DomainWork.LOADING -> CircularProgressIndicator(Modifier.size(20.dp), color = VibePurple, strokeWidth = 2.dp)
                s.hasDomain -> DomainDetails(s, c)
                else -> AddDomain(s, c, onUpgrade)
            }
            s.error?.let { ErrorText(it, s) }
        }
    }

    if (s.confirmingRemove) {
        AlertDialog(
            onDismissRequest = { c.cancelRemove() },
            title = { Text(stringResource(R.string.custom_domain_remove_title, s.domain.orEmpty())) },
            text = { Text(stringResource(R.string.custom_domain_remove_body)) },
            confirmButton = { TextButton(onClick = { c.confirmRemove() }) { Text(stringResource(R.string.app_keys_remove), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { c.cancelRemove() }) { Text(stringResource(R.string.cancel)) } }
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AddDomain(s: CustomDomainState, c: CustomDomainController, onUpgrade: () -> Unit) {
    if (s.upgradeRequired) {
        Text(stringResource(R.string.custom_domain_pro_only), color = TextSecondary, style = MaterialTheme.typography.bodySmall)
        Button(
            onClick = onUpgrade,
            colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
            shape = RoundedCornerShape(10.dp)
        ) { Text(stringResource(R.string.upgrade_to_pro)) }
        return
    }
    Text(stringResource(R.string.custom_domain_hint), color = TextSecondary, style = MaterialTheme.typography.bodySmall)
    // When the field gains focus, scroll it (plus the Add button below it) above the keyboard.
    val requester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    var fieldSize by remember { mutableStateOf(IntSize.Zero) }
    OutlinedTextField(
        value = s.input,
        onValueChange = c::onInputChanged,
        modifier = Modifier
            .fillMaxWidth()
            .onSizeChanged { fieldSize = it }
            .bringIntoViewRequester(requester)
            .onFocusEvent { focus ->
                if (focus.isFocused) scope.launch {
                    delay(350) // let the keyboard animation finish before measuring
                    val extra = with(density) { 72.dp.toPx() }
                    requester.bringIntoView(Rect(0f, 0f, fieldSize.width.toFloat(), fieldSize.height + extra))
                }
            },
        singleLine = true,
        placeholder = { Text("www.example.com") },
        isError = s.error is DomainError.Validation,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        enabled = s.work == DomainWork.IDLE
    )
    Button(
        onClick = { c.add() },
        enabled = s.work == DomainWork.IDLE && s.input.isNotBlank(),
        colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
        shape = RoundedCornerShape(10.dp)
    ) {
        if (s.work == DomainWork.ADDING) CircularProgressIndicator(Modifier.size(18.dp), color = TextPrimary, strokeWidth = 2.dp)
        else Text(stringResource(R.string.custom_domain_add))
    }
}

@Composable
private fun DomainDetails(s: CustomDomainState, c: CustomDomainController) {
    val context = LocalContext.current
    Text(s.domain.orEmpty(), color = VibePurple, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)

    // Progress: Waiting for DNS -> Issuing certificate -> Live
    val (label, live) = when (s.status) {
        DomainStatus.ACTIVE -> stringResource(R.string.live) to true
        DomainStatus.DNS_VERIFIED, DomainStatus.SSL_PROVISIONING -> stringResource(R.string.custom_domain_status_issuing) to false
        else -> stringResource(R.string.custom_domain_status_waiting) to false
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (live) Icon(Icons.Default.Check, null, tint = VibeGreen, modifier = Modifier.size(18.dp))
        else if (s.polling) CircularProgressIndicator(Modifier.size(16.dp), color = VibePurple, strokeWidth = 2.dp)
        Spacer(Modifier.width(8.dp))
        Text(label, color = if (live) VibeGreen else TextSecondary, style = MaterialTheme.typography.bodyMedium)
    }

    if (!live) DnsInstructions(s)

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        if (live) {
            Button(
                onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://${s.domain}"))) },
                colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                shape = RoundedCornerShape(10.dp), modifier = Modifier.weight(1f)
            ) { Text(stringResource(R.string.open)) }
        } else {
            Button(
                onClick = { c.verify() },
                enabled = s.work == DomainWork.IDLE && !s.polling,
                colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                shape = RoundedCornerShape(10.dp), modifier = Modifier.weight(1f)
            ) { Text(stringResource(if (s.polling || s.work == DomainWork.VERIFYING) R.string.custom_domain_checking else R.string.build_phase_verify)) }
        }
        OutlinedButton(
            onClick = { c.requestRemove() },
            enabled = s.work == DomainWork.IDLE,
            shape = RoundedCornerShape(10.dp), modifier = Modifier.weight(1f)
        ) { Text(stringResource(R.string.app_keys_remove), color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun DnsInstructions(s: CustomDomainState) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.custom_domain_dns_instructions),
            color = TextSecondary, style = MaterialTheme.typography.bodySmall
        )
        if (s.isApex && (s.apexA.isNotEmpty() || s.apexAaaa.isNotEmpty())) {
            Text(stringResource(R.string.custom_domain_root_records), color = TextPrimary, style = MaterialTheme.typography.labelLarge)
            s.apexA.forEach { RecordRow("A", "@", it) }
            s.apexAaaa.forEach { RecordRow("AAAA", "@", it) }
        } else if (s.isApex) {
            Text(
                stringResource(R.string.custom_domain_apex_warning, s.domain.orEmpty()),
                color = VibeOrange, style = MaterialTheme.typography.bodySmall
            )
            s.cnameTarget?.let { RecordRow("ALIAS/CNAME", "@", it) }
        } else {
            val host = s.domain?.substringBefore('.') ?: ""
            s.cnameTarget?.let { RecordRow("CNAME", host, it) }
        }
        if (!s.txtValue.isNullOrBlank()) {
            Text(stringResource(R.string.custom_domain_txt_alt), color = TextSecondary, style = MaterialTheme.typography.labelMedium)
            RecordRow("TXT", s.txtRecord ?: "_vibebuilder.${s.domain}", s.txtValue)
        }
    }
}

@Composable
private fun RecordRow(type: String, name: String, value: String) {
    val clipboard = LocalClipboardManager.current
    Card(
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, DarkBorder),
        colors = CardDefaults.cardColors(containerColor = DarkSurface)
    ) {
        Row(Modifier.padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.custom_domain_record_label, type, name), color = TextTertiary, style = MaterialTheme.typography.labelSmall)
                Text(value, color = TextPrimary, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = { clipboard.setText(AnnotatedString(value)) }) {
                Icon(Icons.Default.ContentCopy, contentDescription = stringResource(R.string.custom_domain_copy_value, type), tint = VibePurple, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun ErrorText(e: DomainError, s: CustomDomainState) {
    val msg = when (e) {
        is DomainError.Validation -> e.kind?.let { stringResource(invalidDomainRes(it)) } ?: e.message.orEmpty()
        DomainError.ProRequired -> stringResource(R.string.custom_domain_pro_feature)
        DomainError.Unavailable -> stringResource(R.string.custom_domain_unavailable)
        DomainError.AlreadyRegistered -> stringResource(R.string.custom_domain_err_already)
        DomainError.Network -> stringResource(R.string.custom_domain_err_network)
        is DomainError.DnsNotFound -> buildString {
            append(stringResource(R.string.custom_domain_err_dns))
            if (s.isApex && s.apexA.isNotEmpty()) append("\n").append(stringResource(R.string.custom_domain_dns_expect_a))
            else e.expectedCname?.let { append("\n").append(stringResource(R.string.custom_domain_dns_expect_cname, it)) }
            if (!e.expectedTxt.isNullOrBlank()) append("\n").append(stringResource(R.string.custom_domain_dns_expect_txt, e.expectedTxt))
        }
        DomainError.PollTimeout -> stringResource(R.string.custom_domain_err_poll_timeout)
        is DomainError.Other -> e.message
    }
    Text(msg, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
}

@androidx.annotation.StringRes
internal fun invalidDomainRes(kind: DomainInvalid): Int = when (kind) {
    DomainInvalid.EMPTY -> R.string.domain_invalid_empty
    DomainInvalid.TOO_LONG -> R.string.domain_invalid_too_long
    DomainInvalid.NO_EXTENSION -> R.string.domain_invalid_extension
    DomainInvalid.BAD_CHARACTERS -> R.string.domain_invalid_characters
    DomainInvalid.NOT_A_DOMAIN -> R.string.domain_invalid_generic
    DomainInvalid.OWN_ADDRESS -> R.string.domain_invalid_own_address
}
