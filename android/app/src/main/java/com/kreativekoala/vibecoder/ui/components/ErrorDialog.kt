package com.kreativekoala.vibecoder.ui.components

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import com.kreativekoala.vibecoder.ui.theme.DarkSurfaceVariant
import com.kreativekoala.vibecoder.ui.theme.VibePurple

@Composable
fun ErrorDialog(
    message: String,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Error") },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("OK", color = VibePurple)
            }
        },
        containerColor = DarkSurfaceVariant
    )
}
