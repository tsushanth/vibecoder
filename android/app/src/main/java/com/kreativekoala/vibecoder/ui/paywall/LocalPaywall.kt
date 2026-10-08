package com.kreativekoala.vibecoder.ui.paywall

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.ui.theme.*

sealed interface PaywallUiState {
    data object Loading : PaywallUiState
    /** The store gave no plans, or did not answer in time. */
    data object Unavailable : PaywallUiState
    data class Ready(val plans: List<PaywallPlan>, val selectedId: String?) : PaywallUiState
}

private val FEATURES = listOf(
    "🎨" to R.string.paywall_feature_projects,
    "🤖" to R.string.paywall_feature_ai,
    "🚀" to R.string.paywall_feature_deploy,
    "📱" to R.string.paywall_feature_templates,
    "💾" to R.string.paywall_feature_storage
)

/**
 * The one paywall screen: close button (when it can be dismissed), what you get, the plans, and a call to action that stays pinned
 * at the bottom so it never needs a scroll. Stateless: [PaywallHost] owns the store calls.
 */
@Composable
fun LocalPaywall(
    state: PaywallUiState,
    busy: Boolean,
    message: String?,
    dismissible: Boolean,
    onSelect: (String) -> Unit,
    onPurchase: () -> Unit,
    onRestore: () -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
    onRedeem: () -> Unit,
    onOpenTerms: () -> Unit,
    onOpenPrivacy: () -> Unit
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(DarkSurfaceVariant, DarkSurface, DarkBackground)))
    ) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                if (dismissible) {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.paywall_close), tint = TextSecondary)
                    }
                }
            }

            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    Modifier.size(64.dp).background(Brush.linearGradient(listOf(VibePurple, VibePurpleLight, VibeBlue)), RoundedCornerShape(16.dp)),
                    contentAlignment = Alignment.Center
                ) { Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(32.dp)) }
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.paywall_title), color = TextPrimary, fontSize = 26.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Spacer(Modifier.height(4.dp))
                Text(stringResource(R.string.paywall_subtitle), color = TextSecondary, fontSize = 15.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(20.dp))
                Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    FEATURES.forEach { (emoji, text) ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(emoji, fontSize = 20.sp)
                            Spacer(Modifier.width(12.dp))
                            Text(stringResource(text), color = TextPrimary, fontSize = 15.sp)
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
                when (state) {
                    PaywallUiState.Loading -> CircularProgressIndicator(Modifier.size(28.dp), color = VibePurple, strokeWidth = 3.dp)
                    PaywallUiState.Unavailable -> {
                        Text(stringResource(R.string.paywall_unavailable), color = TextSecondary, textAlign = TextAlign.Center, fontSize = 14.sp)
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = onRetry, shape = RoundedCornerShape(10.dp)) { Text(stringResource(R.string.paywall_retry)) }
                    }
                    is PaywallUiState.Ready -> Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                        state.plans.forEach { plan -> PlanCard(plan, selected = plan.productId == state.selectedId, bestValue = PaywallPlans.showsBestValue(state.plans, plan), enabled = !busy) { onSelect(plan.productId) } }
                    }
                }
                Spacer(Modifier.height(16.dp))
            }

            // pinned bottom bar
            HorizontalDivider(color = DarkBorder)
            Column(Modifier.fillMaxWidth().background(DarkBackground).padding(horizontal = 24.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (message != null) {
                    Text(message, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(8.dp))
                }
                val selected = (state as? PaywallUiState.Ready)?.let { r -> r.plans.firstOrNull { it.productId == r.selectedId } }
                Button(
                    onClick = onPurchase,
                    enabled = selected != null && !busy,
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple)
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(22.dp), color = TextPrimary, strokeWidth = 2.dp)
                    else Text(stringResource(if (selected?.trialDays != null) R.string.paywall_cta_trial else R.string.paywall_cta_continue), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(6.dp))
                Text(stringResource(R.string.paywall_renewal), color = TextTertiary, fontSize = 11.sp, textAlign = TextAlign.Center)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = onRestore, enabled = !busy) { Text(stringResource(R.string.paywall_restore), fontSize = 12.sp, color = TextSecondary) }
                    TextButton(onClick = onRedeem, enabled = !busy) { Text(stringResource(R.string.paywall_redeem), fontSize = 12.sp, color = TextSecondary) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(stringResource(R.string.paywall_terms), color = TextTertiary, fontSize = 11.sp, modifier = Modifier.clickable(onClick = onOpenTerms))
                    Text(stringResource(R.string.paywall_privacy), color = TextTertiary, fontSize = 11.sp, modifier = Modifier.clickable(onClick = onOpenPrivacy))
                }
            }
        }
    }
}

@Composable
private fun PlanCard(plan: PaywallPlan, selected: Boolean, bestValue: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) VibePurple else DarkBorder),
        colors = CardDefaults.cardColors(containerColor = if (selected) VibePurple.copy(alpha = 0.12f) else DarkSurface),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = selected, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = VibePurple))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(planTitle(plan.period)), color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                plan.trialDays?.let { Text(stringResource(R.string.paywall_trial_days, it), color = VibeGreen, fontSize = 12.sp) }
            }
            Column(horizontalAlignment = Alignment.End) {
                if (bestValue) Text(stringResource(R.string.paywall_badge_best_value), color = VibeGreen, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Text(stringResource(priceFormat(plan.period), plan.priceText), color = TextPrimary, fontSize = 15.sp)
            }
        }
    }
}

private fun planTitle(p: PlanPeriod) = when (p) {
    PlanPeriod.YEARLY -> R.string.paywall_plan_yearly
    PlanPeriod.MONTHLY -> R.string.paywall_plan_monthly
    PlanPeriod.WEEKLY -> R.string.paywall_plan_weekly
    PlanPeriod.LIFETIME -> R.string.paywall_plan_lifetime
}

private fun priceFormat(p: PlanPeriod) = when (p) {
    PlanPeriod.YEARLY -> R.string.paywall_price_per_year
    PlanPeriod.MONTHLY -> R.string.paywall_price_per_month
    PlanPeriod.WEEKLY -> R.string.paywall_price_per_week
    PlanPeriod.LIFETIME -> R.string.paywall_price_once
}
