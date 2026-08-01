package com.kreativekoala.vibecoder.ui.create

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.vibecoder.data.model.Template
import com.kreativekoala.vibecoder.ui.theme.TextPrimary
import com.kreativekoala.vibecoder.ui.theme.VibePurple

/**
 * Horizontal scrolling row of template cards. Each card is a single tap to
 * fill the user's prompt with the template's description. Visually heavier
 * than [SuggestionChips] because templates carry richer metadata (creator,
 * difficulty, category).
 */
@Composable
fun TemplateRow(
    templates: List<Template>,
    onTemplateClick: (Template) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Text(
            text = "Templates · tap to start",
            style = MaterialTheme.typography.bodySmall,
            color = TextPrimary.copy(alpha = 0.6f),
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp)
        )

        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(horizontal = 4.dp),
        ) {
            items(templates) { template ->
                TemplateCard(template = template, onClick = { onTemplateClick(template) })
            }
        }
    }
}

@Composable
private fun TemplateCard(template: Template, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = Color.White.copy(alpha = 0.06f),
        modifier = Modifier
            .width(220.dp)
            .height(120.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Badge(text = template.difficulty, color = colorFor(template.difficulty))
                Badge(text = template.category, color = Color.White.copy(alpha = 0.12f))
            }
            Column {
                Text(
                    text = template.title,
                    style = MaterialTheme.typography.titleSmall,
                    color = TextPrimary,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                )
                Text(
                    text = "by ${template.creator}",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextPrimary.copy(alpha = 0.55f),
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun Badge(text: String, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(color)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(
            text = text.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = TextPrimary,
            fontWeight = FontWeight.Bold,
        )
    }
}

private fun colorFor(difficulty: String): Color = when (difficulty.lowercase()) {
    "beginner" -> Color(0xFF45B97A).copy(alpha = 0.7f)
    "intermediate" -> VibePurple.copy(alpha = 0.7f)
    else -> Color(0xFFE08746).copy(alpha = 0.7f)
}
