package com.kreativekoala.vibecoder.ui.components

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.DarkSurfaceVariant
import com.kreativekoala.vibecoder.ui.theme.VibePurple

@Composable
fun ErrorDialog(
    message: String,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.error)) },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.ok), color = VibePurple)
            }
        },
        containerColor = DarkSurfaceVariant
    )
}
