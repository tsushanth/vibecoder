package com.kreativekoala.vibecoder

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.kreativekoala.paywallkit.manager.PaywallManager
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallProduct
import com.kreativekoala.paywallkit.view.PaywallView
import com.kreativekoala.ratingkit.RatingKit
import com.kreativekoala.vibecoder.service.FacebookSDKHelper
import com.kreativekoala.vibecoder.service.TikTokHelper
import com.kreativekoala.vibecoder.navigation.VibeBuildNavGraph
import com.kreativekoala.vibecoder.ui.theme.VibeBuildTheme
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.interfaces.ReceiveCustomerInfoCallback
import com.revenuecat.purchases.purchaseWith
import com.revenuecat.purchases.restorePurchasesWith
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val PREFS_NAME = "vibebuild_paywall_prefs"
        private const val KEY_GENERATION_COUNT = "generation_count"
        const val FREE_GENERATION_LIMIT = 10

        fun incrementGenerationCount(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val current = prefs.getInt(KEY_GENERATION_COUNT, 0)
            prefs.edit().putInt(KEY_GENERATION_COUNT, current + 1).apply()
            Log.d(TAG, "Generation count incremented to ${current + 1}")
        }

        fun getGenerationCount(context: Context): Int {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getInt(KEY_GENERATION_COUNT, 0)
        }

        fun isPremiumUser(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getBoolean("is_premium", false)
        }

        fun setPremiumUser(context: Context, premium: Boolean) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putBoolean("is_premium", premium).apply()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        RatingKit.trackAppOpen(this)

        setContent {
            VibeBuildTheme {
                AppContentWithPaywallGate()
            }
        }
    }

    @Composable
    private fun AppContentWithPaywallGate() {
        var isPremium by remember { mutableStateOf<Boolean?>(null) }
        val generationCount = remember { getGenerationCount(this@MainActivity) }
        var packages by remember { mutableStateOf<List<Package>>(emptyList()) }
        var productsLoaded by remember { mutableStateOf(false) }

        // Check subscription status via RevenueCat
        LaunchedEffect(Unit) {
            Purchases.sharedInstance.getCustomerInfo(
                callback = object : ReceiveCustomerInfoCallback {
                    override fun onReceived(customerInfo: CustomerInfo) {
                        val hasPro = customerInfo.entitlements["pro"]?.isActive == true
                        val hasTeam = customerInfo.entitlements["team"]?.isActive == true
                        val hasAny = customerInfo.entitlements.active.isNotEmpty()
                        val isActive = hasPro || hasTeam || hasAny
                        isPremium = isActive
                        setPremiumUser(this@MainActivity, isActive)
                        Log.d(TAG, "RC entitlements: active=${customerInfo.entitlements.active.keys}, isPremium=$isActive")
                    }

                    override fun onError(error: PurchasesError) {
                        Log.e(TAG, "Error checking entitlements: ${error.message}")
                        // Don't downgrade — use cached value so offline purchase still works
                        isPremium = isPremiumUser(this@MainActivity)
                    }
                }
            )
        }

        // Load RevenueCat offerings for paywall products
        LaunchedEffect(Unit) {
            Purchases.sharedInstance.getOfferingsWith(
                onError = { error ->
                    Log.e(TAG, "Error fetching offerings: ${error.message}")
                    productsLoaded = true // mark loaded even on error so UI proceeds
                },
                onSuccess = { offerings ->
                    packages = offerings.current?.availablePackages ?: emptyList()
                    productsLoaded = true
                }
            )
        }

        // Wait for subscription check to complete
        val premium = isPremium ?: return

        // Wait for products to load before showing paywall
        if (!productsLoaded) return

        val shouldShowPaywall = !premium && generationCount >= FREE_GENERATION_LIMIT

        if (shouldShowPaywall) {
            val paywallProducts = packages.mapNotNull { pkg ->
                mapPackageToPaywallProduct(pkg)
            }

            // Block back button so the paywall cannot be dismissed
            BackHandler(enabled = true) {
                // Do nothing — hard paywall cannot be dismissed
            }

            Box(modifier = Modifier.fillMaxSize()) {
                PaywallView(
                    appId = "vibebuild",
                    appName = "VibeBuild",
                    features = listOf(
                        PaywallFeature("\uD83C\uDFA8", "Unlimited Projects", "Build without limits"),
                        PaywallFeature("\uD83E\uDD16", "AI Assistant", "AI-powered development"),
                        PaywallFeature("\uD83D\uDE80", "Cloud Deploy", "One-click deployment"),
                        PaywallFeature("\uD83D\uDCF1", "All Templates", "Access every template"),
                        PaywallFeature("\uD83D\uDCBE", "Cloud Storage", "Unlimited cloud storage")
                    ),
                    products = paywallProducts,
                    isDismissible = false,
                    showWinback = true,
                    onPurchase = { productId ->
                        val pkg = packages.firstOrNull { it.product.id == productId }
                        if (pkg != null) {
                            Purchases.sharedInstance.purchaseWith(
                                PurchaseParams.Builder(this@MainActivity, pkg).build(),
                                onError = { error, _ ->
                                    Log.e(TAG, "Purchase error: ${error.message}")
                                },
                                onSuccess = { _, customerInfo ->
                                    val hasPro = customerInfo.entitlements["pro"]?.isActive == true
                                    val hasTeam = customerInfo.entitlements["team"]?.isActive == true
                                    val hasAny = customerInfo.entitlements.active.isNotEmpty()
                                    if (hasPro || hasTeam || hasAny) {
                                        isPremium = true
                                        setPremiumUser(this@MainActivity, true)
                                    }
                                    val price = pkg.product.price.amountMicros / 1_000_000.0
                                    val currency = pkg.product.price.currencyCode
                                    TikTokHelper.trackPurchase(productId, price)
                                    RatingKit.trackPurchase(this@MainActivity)
                                    // Meta attribution — without this, the Meta ad campaign can't
                                    // close the CAC loop (was missing on hard paywall, only soft
                                    // paywall in SubscriptionViewModel had it).
                                    FacebookSDKHelper.logPurchase(price, currency, productId)
                                    if (pkg.product.subscriptionOptions?.freeTrial != null) {
                                        FacebookSDKHelper.logTrialStarted(productId)
                                    }
                                    PaywallManager.trackEvent(
                                        appId = "vibebuild",
                                        placement = "paywall",
                                        templateId = "default",
                                        event = "purchased",
                                        productId = productId
                                    )
                                }
                            )
                        }
                    },
                    onRestore = {
                        Purchases.sharedInstance.restorePurchasesWith(
                            onError = { error ->
                                Log.e(TAG, "Restore error: ${error.message}")
                            },
                            onSuccess = { customerInfo ->
                                val hasPro = customerInfo.entitlements["pro"]?.isActive == true
                                val hasTeam = customerInfo.entitlements["team"]?.isActive == true
                                val hasAny = customerInfo.entitlements.active.isNotEmpty()
                                if (hasPro || hasTeam || hasAny) {
                                    isPremium = true
                                    setPremiumUser(this@MainActivity, true)
                                }
                            }
                        )
                    },
                    onRedeemCode = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/redeem?code=promo-1month-free"))
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        try { startActivity(intent) } catch (_: Exception) {}
                    },
                    onDismiss = {
                        // Non-dismissible paywall — no action needed
                    }
                )
            }
        } else {
            VibeBuildNavGraph()
        }
    }

    /**
     * Maps a RevenueCat Package to a PaywallKit PaywallProduct.
     */
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
                else -> null
            }
        }
        return PaywallProduct(
            id = product.id,
            localizedPrice = product.price.formatted,
            price = product.price.amountMicros / 1_000_000.0,
            currencyCode = product.price.currencyCode,
            trialDays = trialDays,
            period = period
        )
    }
}
