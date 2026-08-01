package com.kreativekoala.vibecoder.ui.create

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.data.model.Suggestion
import com.kreativekoala.vibecoder.ui.theme.DarkSurfaceElevated
import com.kreativekoala.vibecoder.ui.theme.TextPrimary
import com.kreativekoala.vibecoder.ui.theme.VibePurple

@Composable
fun SuggestionChips(
    suggestions: List<Suggestion>,
    onSuggestionClick: (Suggestion) -> Unit,
    modifier: Modifier = Modifier,
    isLoadingSuggestions: Boolean = false,
    onSuggestNewIdeas: (() -> Unit)? = null
) {
    if (suggestions.isEmpty()) return

    Column(modifier = modifier) {
        Text(
            text = stringResource(R.string.suggestions_header),
            style = MaterialTheme.typography.bodySmall,
            color = TextPrimary.copy(alpha = 0.6f),
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp)
        )

        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(horizontal = 4.dp)
        ) {
            items(suggestions) { suggestion ->
                SuggestionChipButton(
                    label = suggestion.label,
                    onClick = { onSuggestionClick(suggestion) }
                )
            }
        }

        if (onSuggestNewIdeas != null) {
            Spacer(modifier = Modifier.height(12.dp))
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                OutlinedButton(
                    onClick = onSuggestNewIdeas,
                    enabled = !isLoadingSuggestions,
                    shape = RoundedCornerShape(20.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = VibePurple
                    ),
                    border = ButtonDefaults.outlinedButtonBorder(enabled = true).copy(
                        brush = androidx.compose.ui.graphics.SolidColor(VibePurple.copy(alpha = 0.3f))
                    ),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
                ) {
                    if (isLoadingSuggestions) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            strokeWidth = 2.dp,
                            color = VibePurple
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = stringResource(R.string.suggestions_btn_generating),
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium
                        )
                    } else {
                        Text(
                            text = stringResource(R.string.suggestions_btn_suggest_new),
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SuggestionChipButton(
    label: String,
    onClick: () -> Unit
) {
    SuggestionChip(
        onClick = onClick,
        label = {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall
            )
        },
        shape = RoundedCornerShape(20.dp),
        colors = SuggestionChipDefaults.suggestionChipColors(
            containerColor = DarkSurfaceElevated,
            labelColor = TextPrimary
        ),
        border = SuggestionChipDefaults.suggestionChipBorder(
            enabled = true,
            borderColor = VibePurple.copy(alpha = 0.3f)
        )
    )
}
