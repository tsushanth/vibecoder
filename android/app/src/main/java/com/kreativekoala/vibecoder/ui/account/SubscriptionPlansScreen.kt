package com.kreativekoala.vibecoder.ui.account

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.kreativekoala.paywallkit.manager.PaywallManager
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallProduct
import com.kreativekoala.paywallkit.view.PaywallView
import com.kreativekoala.ratingkit.RatingKit
import com.kreativekoala.vibecoder.MainActivity
import com.kreativekoala.vibecoder.service.FacebookSDKHelper
import com.kreativekoala.vibecoder.service.TikTokHelper
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.purchaseWith
import com.revenuecat.purchases.restorePurchasesWith

private const val TAG = "SubscriptionPlans"

/**
 * Renders the PaywallKit-Android paywall (same component MainActivity's
 * app-launch gate uses). Replaces the previous bare RevenueCat `Paywall`
 * component so all three paywall surfaces (onboarding, "Upgrade to Pro" tap,
 * and the attempt-#4 hard gate) share one design + A/B-testable template.
 *
 * @param hardGate When true, hides the close button and blocks back navigation
 *  so the user can only leave by completing a purchase.
 */
@Composable
fun SubscriptionPlansScreen(
    onBack: () -> Unit,
    hardGate: Boolean = false,
) {
    val context = LocalContext.current
    val activity = context as? Activity
    var packages by remember { mutableStateOf<List<Package>>(emptyList()) }

    LaunchedEffect(Unit) {
        Purchases.sharedInstance.getOfferingsWith(
            onError = { error -> Log.e(TAG, "offerings error: ${error.message}") },
            onSuccess = { offerings ->
                packages = offerings.current?.availablePackages ?: emptyList()
            },
        )
    }

    if (hardGate) {
        BackHandler(enabled = true) { /* swallow back */ }
    }

    val paywallProducts = packages.mapNotNull { mapPackageToPaywallProduct(it) }

    Box(modifier = Modifier.fillMaxSize()) {
        PaywallView(
            appId = "vibebuild",
            appName = "VibeBuild",
            features = listOf(
                PaywallFeature("🎨", "Unlimited Projects", "Build without limits"),
                PaywallFeature("🤖", "AI Assistant", "AI-powered development"),
                PaywallFeature("🚀", "Cloud Deploy", "One-click deployment"),
                PaywallFeature("📱", "All Templates", "Access every template"),
                PaywallFeature("💾", "Cloud Storage", "Unlimited cloud storage"),
            ),
            products = paywallProducts,
            isDismissible = !hardGate,
            showWinback = true,
            onPurchase = { productId ->
                val pkg = packages.firstOrNull { it.product.id == productId } ?: return@PaywallView
                val act = activity ?: return@PaywallView
                Purchases.sharedInstance.purchaseWith(
                    PurchaseParams.Builder(act, pkg).build(),
                    onError = { error, _ -> Log.e(TAG, "purchase error: ${error.message}") },
                    onSuccess = { _, customerInfo ->
                        val hasAny = customerInfo.entitlements.active.isNotEmpty()
                        if (hasAny) MainActivity.setPremiumUser(context, true)
                        val price = pkg.product.price.amountMicros / 1_000_000.0
                        val currency = pkg.product.price.currencyCode
                        TikTokHelper.trackPurchase(productId, price)
                        RatingKit.trackPurchase(act)
                        FacebookSDKHelper.logPurchase(price, currency, productId)
                        if (pkg.product.subscriptionOptions?.freeTrial != null) {
                            FacebookSDKHelper.logTrialStarted(productId)
                        }
                        PaywallManager.trackEvent(
                            appId = "vibebuild",
                            placement = if (hardGate) "hard_paywall" else "subscriptions",
                            templateId = "default",
                            event = "purchased",
                            productId = productId,
                        )
                        onBack()
                    },
                )
            },
            onRestore = {
                Purchases.sharedInstance.restorePurchasesWith(
                    onError = { error -> Log.e(TAG, "restore error: ${error.message}") },
                    onSuccess = { customerInfo ->
                        val hasAny = customerInfo.entitlements.active.isNotEmpty()
                        if (hasAny) {
                            MainActivity.setPremiumUser(context, true)
                            onBack()
                        }
                    },
                )
            },
            onRedeemCode = {
                val intent = Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/redeem?code=promo-1month-free"),
                )
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { context.startActivity(intent) } catch (_: Exception) {}
            },
            onDismiss = {
                if (!hardGate) onBack()
                // If hardGate: do nothing. User must purchase to leave.
            },
        )
    }
}

private fun mapPackageToPaywallProduct(pkg: Package): PaywallProduct? {
    val product = pkg.product
    val period = when {
        product.period?.unit?.name == "YEAR" -> PaywallProduct.Period.YEARLY
        product.period?.unit?.name == "MONTH" -> PaywallProduct.Period.MONTHLY
        product.period?.unit?.name == "WEEK" -> PaywallProduct.Period.WEEKLY
        product.period == null -> PaywallProduct.Period.LIFETIME
        else -> return null
    }
    val trialDays = product.subscriptionOptions?.freeTrial?.freePhase?.billingPeriod?.let { bp ->
        when (bp.unit?.name) {
            "DAY" -> bp.value
            "WEEK" -> bp.value * 7
            "MONTH" -> bp.value * 30
            "YEAR" -> bp.value * 365
            else -> null
        }
    }
    val priceMicros = product.price.amountMicros
    val priceDouble = priceMicros / 1_000_000.0
    val currency = product.price.currencyCode
    return PaywallProduct(
        id = product.id,
        period = period,
        price = priceDouble,
        currencyCode = currency,
        localizedPrice = product.price.formatted,
        trialDays = trialDays,
    )
}
