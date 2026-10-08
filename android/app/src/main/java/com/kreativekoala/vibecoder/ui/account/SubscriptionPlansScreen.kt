package com.kreativekoala.vibecoder.ui.account

import androidx.compose.runtime.Composable
import com.kreativekoala.vibecoder.ui.paywall.PaywallHost

/**
 * The "Upgrade" paywall (onboarding, an Upgrade tap, and the hard gate after the free limit). All the work is in [PaywallHost].
 *
 * @param hardGate When true the close button and back navigation are blocked, so the only way out is a purchase or restore.
 */
@Composable
fun SubscriptionPlansScreen(
    onBack: () -> Unit,
    hardGate: Boolean = false,
) {
    PaywallHost(
        placement = if (hardGate) "hard_paywall" else "subscriptions",
        hardGate = hardGate,
        onUnlocked = onBack,
        onDismiss = { if (!hardGate) onBack() }
    )
}
