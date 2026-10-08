package com.kreativekoala.vibecoder.ui.paywall

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.kreativekoala.ratingkit.RatingKit
import com.kreativekoala.vibecoder.MainActivity
import com.kreativekoala.vibecoder.R
import com.kreativekoala.vibecoder.service.FacebookSDKHelper
import com.kreativekoala.vibecoder.service.FirebaseAnalyticsHelper
import com.kreativekoala.vibecoder.service.TikTokHelper
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.purchaseWith
import com.revenuecat.purchases.restorePurchasesWith
import kotlinx.coroutines.delay

private const val TAG = "Paywall"
private const val OFFERINGS_TIMEOUT_MS = 10_000L
private const val TERMS_URL = "https://vibebuild.cc/terms"
private const val PRIVACY_URL = "https://vibebuild.cc/privacy"
private const val REDEEM_URL = "https://play.google.com/redeem?code=promo-1month-free"

/**
 * Loads the plans from the store, runs purchase and restore, and shows [LocalPaywall]. Used by the app-launch gate and the
 * "Upgrade" screen. [onUnlocked] runs once a purchase or restore leaves an active entitlement.
 *
 * Never shows a blank screen: while plans load it shows a spinner, and if the store does not answer within ten seconds, or has no
 * plans, it shows a message with a retry.
 */
@Composable
fun PaywallHost(
    placement: String,
    hardGate: Boolean,
    onUnlocked: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    var packages by remember { mutableStateOf<List<Package>?>(null) }
    var timedOut by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { FirebaseAnalyticsHelper.logPaywallViewed(placement) }

    LaunchedEffect(attempt) {
        packages = null; timedOut = false
        Purchases.sharedInstance.getOfferingsWith(
            onError = { error -> Log.e(TAG, "offerings error: ${error.message}"); packages = emptyList() },
            onSuccess = { offerings -> packages = offerings.current?.availablePackages ?: emptyList() }
        )
    }
    LaunchedEffect(attempt) { delay(OFFERINGS_TIMEOUT_MS); if (packages == null) timedOut = true }

    if (hardGate) BackHandler(enabled = true) { /* the hard paywall cannot be dismissed */ }

    val plans = remember(packages) { PaywallPlans.ordered(packages.orEmpty().mapNotNull { it.toPlan() }) }
    LaunchedEffect(plans) { if (selectedId == null || plans.none { it.productId == selectedId }) selectedId = PaywallPlans.defaultSelection(plans) }

    val state = when {
        packages == null && !timedOut -> PaywallUiState.Loading
        plans.isEmpty() -> PaywallUiState.Unavailable
        else -> PaywallUiState.Ready(plans, selectedId)
    }

    val purchaseFailed = stringResource(R.string.paywall_error_purchase)
    val restoreNone = stringResource(R.string.paywall_restore_none)

    LocalPaywall(
        state = state,
        busy = busy,
        message = message,
        dismissible = !hardGate,
        onSelect = { selectedId = it; message = null },
        onPurchase = {
            val pkg = packages?.firstOrNull { it.product.id == selectedId }
            val act = activity
            if (pkg != null && act != null && !busy) {
                busy = true; message = null
                Purchases.sharedInstance.purchaseWith(
                    PurchaseParams.Builder(act, pkg).build(),
                    onError = { error, userCancelled ->
                        busy = false
                        if (!userCancelled) { Log.e(TAG, "purchase error: ${error.message}"); message = purchaseFailed }
                    },
                    onSuccess = { _, customerInfo ->
                        busy = false
                        if (customerInfo.entitlements.active.isNotEmpty()) {
                            MainActivity.setPremiumUser(context, true)
                            trackPurchase(act, pkg)
                            onUnlocked()
                        }
                    }
                )
            }
        },
        onRestore = {
            if (!busy) {
                busy = true; message = null
                Purchases.sharedInstance.restorePurchasesWith(
                    onError = { error -> busy = false; Log.e(TAG, "restore error: ${error.message}"); message = purchaseFailed },
                    onSuccess = { customerInfo ->
                        busy = false
                        if (customerInfo.entitlements.active.isNotEmpty()) { MainActivity.setPremiumUser(context, true); onUnlocked() }
                        else message = restoreNone
                    }
                )
            }
        },
        onRetry = { attempt++ },
        onDismiss = onDismiss,
        onRedeem = { context.openUrl(REDEEM_URL) },
        onOpenTerms = { context.openUrl(TERMS_URL) },
        onOpenPrivacy = { context.openUrl(PRIVACY_URL) }
    )
}

private fun Package.toPlan(): PaywallPlan? {
    val p = product
    val period = PaywallPlans.periodOf(p.period?.unit?.name, hasPeriod = p.period != null) ?: return null
    val free = p.subscriptionOptions?.freeTrial?.freePhase?.billingPeriod
    return PaywallPlan(p.id, period, p.price.formatted, free?.let { PaywallPlans.trialDays(it.unit?.name, it.value) })
}

private fun trackPurchase(activity: Activity, pkg: Package) {
    val product = pkg.product
    val price = product.price.amountMicros / 1_000_000.0
    FirebaseAnalyticsHelper.logPurchaseCompleted(product.id, price)
    TikTokHelper.trackPurchase(product.id, price)
    FacebookSDKHelper.logPurchase(price, product.price.currencyCode, product.id)
    if (product.subscriptionOptions?.freeTrial != null) FacebookSDKHelper.logTrialStarted(product.id)
    RatingKit.trackPurchase(activity)
}

private fun Context.openUrl(url: String) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try { startActivity(intent) } catch (_: Exception) { /* no browser installed */ }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
