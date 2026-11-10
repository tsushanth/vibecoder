package com.kreativekoala.vibecoder.ui.apps.explore

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.*

/**
 * "Show on Explore" card on a project, the same setting as the Publish dialog on the web. Off by default: a new build, save or fork
 * stays unlisted until its creator turns this on. [knownListed] saves a read when the caller already has the setting.
 */
@Composable
fun ExploreListingSection(
    projectId: String,
    modifier: Modifier = Modifier,
    knownListed: Boolean? = null,
    viewModel: ExploreListingViewModel = hiltViewModel()
) {
    val c = viewModel.controller
    val s by c.state.collectAsState()
    LaunchedEffect(projectId) { c.load(projectId, knownListed) }
    if (!s.ready) return

    Card(
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, DarkBorder),
        colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant),
        modifier = modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .toggleable(value = s.listed, enabled = !s.saving, role = Role.Switch, onValueChange = { c.setListed(it) }),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.explore_listing_title),
                        style = MaterialTheme.typography.titleSmall,
                        color = TextPrimary,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.explore_listing_hint), style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                }
                Spacer(Modifier.width(12.dp))
                Switch(
                    checked = s.listed,
                    onCheckedChange = null,
                    enabled = !s.saving,
                    colors = SwitchDefaults.colors(checkedTrackColor = VibePurple)
                )
            }
            if (s.failed) {
                Text(stringResource(R.string.explore_listing_failed), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
