package com.kreativekoala.vibecoder.ui.account

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.revenuecat.purchases.ui.revenuecatui.Paywall
import com.revenuecat.purchases.ui.revenuecatui.PaywallOptions

@Composable
fun SubscriptionPlansScreen(
    onBack: () -> Unit
) {
    Box(modifier = Modifier.fillMaxSize()) {
        Paywall(
            options = PaywallOptions.Builder(dismissRequest = { onBack() })
                .setShouldDisplayDismissButton(true)
                .build()
        )
    }
}
