package com.kreativekoala.vibecoder.ui.account

import android.app.Activity
import android.util.Log
import androidx.lifecycle.ViewModel
import com.kreativekoala.paywallkit.manager.PaywallManager
import com.kreativekoala.vibecoder.service.FacebookSDKHelper
import com.kreativekoala.vibecoder.service.FirebaseAnalyticsHelper
import com.kreativekoala.vibecoder.service.TikTokHelper
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.SubscriptionRepository
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Offering
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.purchaseWith
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.restorePurchasesWith
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SubscriptionUiState(
    val offering: Offering? = null,
    val currentTier: String = "free",
    val isPurchasing: Boolean = false,
    val isLoading: Boolean = false,
    val purchaseSuccess: Boolean = false,
    val errorMessage: String? = null
)

@HiltViewModel
class SubscriptionViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val subscriptionRepository: SubscriptionRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SubscriptionUiState())
    val uiState: StateFlow<SubscriptionUiState> = _uiState.asStateFlow()

    companion object {
        private const val TAG = "SubscriptionVM"
        private const val ENTITLEMENT_PRO = "pro"
        private const val ENTITLEMENT_TEAM = "team"
    }

    init {
        loadOfferings()
        loadCurrentTier()
    }

    // ── Load RevenueCat offerings ─────────────────────────────────────

    private fun loadOfferings() {
        _uiState.update { it.copy(isLoading = true) }
        Purchases.sharedInstance.getOfferingsWith(
            onError = { error ->
                Log.e(TAG, "Error fetching offerings: ${error.message}")
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "Could not load plans: ${error.message}"
                    )
                }
            },
            onSuccess = { offerings ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        offering = offerings.current
                    )
                }
            }
        )
    }

    // ── Sync tier from backend + check RC entitlements ─────────────────

    private fun loadCurrentTier() {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            try {
                val status = subscriptionRepository.getSubscriptionStatus(userId)
                _uiState.update { it.copy(currentTier = status.tier) }
            } catch (_: Exception) {}
        }
        // Also check RevenueCat entitlements as source of truth
        checkEntitlements()
    }

    private fun checkEntitlements() {
        Purchases.sharedInstance.getCustomerInfo(
            callback = object : com.revenuecat.purchases.interfaces.ReceiveCustomerInfoCallback {
                override fun onReceived(customerInfo: CustomerInfo) {
                    val tier = when {
                        customerInfo.entitlements[ENTITLEMENT_TEAM]?.isActive == true -> "team"
                        customerInfo.entitlements[ENTITLEMENT_PRO]?.isActive == true -> "pro"
                        else -> "free"
                    }
                    _uiState.update { it.copy(currentTier = tier) }
                }

                override fun onError(error: com.revenuecat.purchases.PurchasesError) {
                    Log.e(TAG, "Error checking entitlements: ${error.message}")
                }
            }
        )
    }

    // ── Purchase a package ────────────────────────────────────────────

    fun purchase(pkg: Package, activity: Activity) {
        _uiState.update { it.copy(isPurchasing = true, errorMessage = null) }

        Purchases.sharedInstance.purchaseWith(
            PurchaseParams.Builder(activity, pkg).build(),
            onError = { error, userCancelled ->
                Log.e(TAG, "Purchase error: ${error.message}, cancelled=$userCancelled")
                _uiState.update {
                    it.copy(
                        isPurchasing = false,
                        errorMessage = if (userCancelled) null else "Purchase failed: ${error.message}"
                    )
                }
            },
            onSuccess = { _, customerInfo ->
                val tier = when {
                    customerInfo.entitlements[ENTITLEMENT_TEAM]?.isActive == true -> "team"
                    customerInfo.entitlements[ENTITLEMENT_PRO]?.isActive == true -> "pro"
                    else -> "free"
                }
                _uiState.update {
                    it.copy(
                        isPurchasing = false,
                        purchaseSuccess = true,
                        currentTier = tier
                    )
                }

                // Track purchase events for ad attribution
                val productId = pkg.product.id
                val price = pkg.product.price.amountMicros / 1_000_000.0
                val currency = pkg.product.price.currencyCode
                FirebaseAnalyticsHelper.logPurchaseCompleted(productId, price)
                TikTokHelper.trackPurchase(productId, price)
                FacebookSDKHelper.logPurchase(price, currency, productId)
                PaywallManager.trackEvent(
                    appId = "vibebuild",
                    placement = "subscription_screen",
                    templateId = "default",
                    event = "purchased",
                    productId = productId
                )

                // Sync the new status to the backend
                syncSubscriptionToBackend()
            }
        )
    }

    // ── Restore purchases ─────────────────────────────────────────────

    fun restorePurchases() {
        _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        Purchases.sharedInstance.restorePurchasesWith(
            onError = { error ->
                Log.e(TAG, "Restore error: ${error.message}")
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "Restore failed: ${error.message}"
                    )
                }
            },
            onSuccess = { customerInfo ->
                val tier = when {
                    customerInfo.entitlements[ENTITLEMENT_TEAM]?.isActive == true -> "team"
                    customerInfo.entitlements[ENTITLEMENT_PRO]?.isActive == true -> "pro"
                    else -> "free"
                }
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        currentTier = tier
                    )
                }
                syncSubscriptionToBackend()
            }
        )
    }

    // ── Dismiss one-shot events ───────────────────────────────────────

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun clearPurchaseSuccess() {
        _uiState.update { it.copy(purchaseSuccess = false) }
    }

    // ── Backend sync helper ───────────────────────────────────────────

    private fun syncSubscriptionToBackend() {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            try {
                subscriptionRepository.getSubscriptionStatus(userId)
            } catch (e: Exception) {
                Log.e(TAG, "Backend sync failed: ${e.message}")
            }
        }
    }
}
