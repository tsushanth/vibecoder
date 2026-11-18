package com.kreativekoala.vibecoder.ui.account

import androidx.annotation.StringRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForwardIos
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.crosspromokit.models.AppId
import com.kreativekoala.crosspromokit.models.PortfolioApp
import com.kreativekoala.crosspromokit.registry.PortfolioRegistry
import com.kreativekoala.crosspromokit.util.PlayStoreLinker
import com.kreativekoala.vibecoder.R

/** The tagline of a promoted app in the app language. The shared cross-promo kit only carries English taglines. */
@StringRes
internal fun promoTaglineRes(id: AppId): Int? = when (id) {
    AppId.CLEARVOICE -> R.string.promo_tagline_clearvoice
    AppId.AUDEXA -> R.string.promo_tagline_audexa
    AppId.READALOUD -> R.string.promo_tagline_readaloud
    AppId.SCRIBEAI -> R.string.promo_tagline_scribeai
    AppId.MEETINGMIND -> R.string.promo_tagline_meetingmind
    AppId.RIDDLEVERSE -> R.string.promo_tagline_riddleverse
    AppId.VIBEBUILD -> null // never promoted to itself
}

/**
 * "More from us" on the Account screen. Same apps, order, icons and Play Store links as the shared CrossPromoSection, but the
 * title and taglines come from this app's strings.xml so they follow the app language. App names are brand names.
 */
@Composable
fun MoreFromUsSection(currentApp: AppId, limit: Int = 4, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val utmSource = remember(currentApp) { currentApp.name.lowercase() + "_android" }
    val items = remember(currentApp, limit) { PortfolioRegistry.promote(currentApp, limit) }
    if (items.isEmpty()) return

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = stringResource(R.string.promo_more_from_us),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        items.forEachIndexed { index, app ->
            PromoRow(app = app, onClick = { PlayStoreLinker.launch(context, app, utmSource = utmSource) })
            if (index < items.lastIndex) {
                HorizontalDivider(
                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
                    modifier = Modifier.padding(start = 72.dp),
                )
            }
        }
    }
}

@Composable
private fun PromoRow(app: PortfolioApp, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Image(
            painter = painterResource(id = app.iconRes),
            contentDescription = null,
            modifier = Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)),
        )
        Spacer(Modifier.size(16.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = app.displayName, // brand name: not translated
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = promoTaglineRes(app.id)?.let { stringResource(it) } ?: app.tagline,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(
            imageVector = Icons.AutoMirrored.Outlined.ArrowForwardIos,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.size(14.dp),
        )
    }
}
