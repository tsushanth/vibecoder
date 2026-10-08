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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.kreativekoala.ratingkit.RatingKit
import com.kreativekoala.vibecoder.service.FacebookSDKHelper
import com.kreativekoala.vibecoder.service.TikTokHelper
import com.kreativekoala.vibecoder.navigation.VibeBuildNavGraph
import com.kreativekoala.vibecoder.ui.paywall.GenerationLimit
import com.kreativekoala.vibecoder.ui.paywall.PaywallHost
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import javax.inject.Inject
import com.kreativekoala.vibecoder.ui.theme.VibePurple
import com.kreativekoala.vibecoder.ui.theme.VibeBuildTheme
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.purchaseWith
import com.revenuecat.purchases.restorePurchasesWith
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    @Inject lateinit var projectRepository: ProjectRepository
    @Inject lateinit var authRepository: AuthRepository

    companion object {
        private const val TAG = "MainActivity"
        private const val PREFS_NAME = "vibebuild_paywall_prefs"
        private const val KEY_GENERATION_COUNT = "generation_count"
        const val FREE_GENERATION_LIMIT = GenerationLimit.FREE_LIMIT
        private const val STATUS_TIMEOUT_MS = 5_000L
        private const val SYNC_ATTEMPTS = 60
        private const val SYNC_RETRY_MS = 2_000L

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

        /** Raises the local counter to the server's project count if that is higher (never lowers it). */
        fun syncGenerationCount(context: Context, serverCount: Int) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val current = prefs.getInt(KEY_GENERATION_COUNT, 0)
            val merged = GenerationLimit.merge(current, serverCount)
            if (merged != current) prefs.edit().putInt(KEY_GENERATION_COUNT, merged).apply()
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
        var generationCount by remember { mutableIntStateOf(getGenerationCount(this@MainActivity)) }

        // Check subscription status via RevenueCat. Uses restorePurchasesWith
        // rather than a plain getCustomerInfo() — RevenueCat's local
        // appUserID is anonymous (no logIn() call anywhere in this app), so
        // a reinstall or cleared app data starts as a brand-new anonymous
        // user with no purchase history even though Google Play Billing
        // still knows the account owns an active subscription. restore
        // re-syncs Play Store purchases to the current RC user before
        // reporting entitlements, so a real purchaser doesn't see the
        // paywall again after a reinstall without manually finding the
        // Restore button. Confirmed bug 2026-08-04, not hypothetical: this
        // is exactly what happens after any app-data-clearing device event.
        LaunchedEffect(Unit) {
            Purchases.sharedInstance.restorePurchasesWith(
                onError = { error ->
                    Log.e(TAG, "Error restoring/checking entitlements: ${error.message}")
                    // Don't downgrade — use cached value so offline purchase still works
                    isPremium = isPremiumUser(this@MainActivity)
                },
                onSuccess = { customerInfo ->
                    val hasPro = customerInfo.entitlements["pro"]?.isActive == true
                    val hasTeam = customerInfo.entitlements["team"]?.isActive == true
                    val hasAny = customerInfo.entitlements.active.isNotEmpty()
                    val isActive = hasPro || hasTeam || hasAny
                    isPremium = isActive
                    setPremiumUser(this@MainActivity, isActive)
                    Log.d(TAG, "RC entitlements after restore: active=${customerInfo.entitlements.active.keys}, isPremium=$isActive")
                }
            )
        }

        // The local build counter is reset by clearing the app's data, so once the user is signed in take the server's project count
        // as a floor. Waits for the session (a fresh install signs in after this screen starts) and gives up quietly offline.
        LaunchedEffect(Unit) {
            repeat(SYNC_ATTEMPTS) {
                val uid = authRepository.currentUser?.uid
                if (uid != null) {
                    val count = runCatching { projectRepository.countMyProjects(uid) }.getOrNull()
                    if (count != null) {
                        syncGenerationCount(this@MainActivity, count)
                        generationCount = getGenerationCount(this@MainActivity)
                        return@LaunchedEffect
                    }
                }
                kotlinx.coroutines.delay(SYNC_RETRY_MS)
            }
        }

        // The launch gate must never leave a blank screen: if the store does not answer (no Play Billing, slow network), use the last
        // known subscription status after a few seconds and carry on.
        LaunchedEffect(Unit) {
            kotlinx.coroutines.delay(STATUS_TIMEOUT_MS)
            if (isPremium == null) isPremium = isPremiumUser(this@MainActivity)
        }

        val premium = isPremium
        if (premium == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = VibePurple) }
            return
        }

        val shouldShowPaywall = GenerationLimit.isOverLimit(premium, generationCount)

        if (shouldShowPaywall) {
            PaywallHost(
                placement = "hard_paywall",
                hardGate = true,
                onUnlocked = { isPremium = true },
                onDismiss = {}
            )
        } else {
            VibeBuildNavGraph()
        }
    }
}
