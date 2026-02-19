package com.kreativekoala.vibecoder.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.vibecoder.ui.theme.*

@Composable
fun SubscriptionTierBadge(
    tier: String,
    modifier: Modifier = Modifier
) {
    val (bgColor, textColor) = when (tier.lowercase()) {
        "pro" -> VibePurple.copy(alpha = 0.2f) to VibePurple
        "team" -> VibeBlue.copy(alpha = 0.2f) to VibeBlue
        "enterprise" -> VibeOrange.copy(alpha = 0.2f) to VibeOrange
        else -> DarkSurfaceElevated to TextTertiary
    }

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = bgColor
    ) {
        Text(
            text = tier.replaceFirstChar { it.uppercase() },
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            color = textColor,
            fontWeight = FontWeight.SemiBold
        )
    }
}
