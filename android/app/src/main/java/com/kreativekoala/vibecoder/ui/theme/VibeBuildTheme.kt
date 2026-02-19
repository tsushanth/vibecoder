package com.kreativekoala.vibecoder.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = VibePurple,
    onPrimary = TextPrimary,
    primaryContainer = VibePurpleDark,
    onPrimaryContainer = TextPrimary,
    secondary = VibeBlue,
    onSecondary = TextPrimary,
    background = DarkBackground,
    onBackground = TextPrimary,
    surface = DarkSurface,
    onSurface = TextPrimary,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = TextSecondary,
    error = ErrorRed,
    onError = TextPrimary,
    outline = DarkBorder
)

@Composable
fun VibeBuildTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = VibeBuildTypography,
        content = content
    )
}
