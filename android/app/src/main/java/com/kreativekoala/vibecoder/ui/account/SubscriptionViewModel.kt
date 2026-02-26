package com.kreativekoala.vibecoder.ui.account

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.SubscriptionRepository
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.interfaces.LogInCallback
import com.revenuecat.purchases.interfaces.PurchaseCallback
import com.revenuecat.purchases.models.StoreTransaction
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SubscriptionUiState(
    val packages: List<Package> = emptyList(),
    val currentTier: String = "free",
    val isPurchasing: Boolean = false,
    val isLoading: Boolean = false,
    val purchaseSuccess: Boolean = false,
    val errorMessage: String? = null
)

@HiltViewModel
class SubscriptionViewModel @Inject constructor(
    private val purchases: Purchases,
    private val authRepository: AuthRepository,
    private val subscriptionRepository: SubscriptionRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SubscriptionUiState())
    val uiState: StateFlow<SubscriptionUiState> = _uiState.asStateFlow()

    init {
        loginToRevenueCat()
        loadOfferings()
        loadCurrentTier()
    }

    private fun loginToRevenueCat() {
        val userId = authRepository.currentUser?.uid ?: return
        purchases.logIn(userId, object : LogInCallback {
            override fun onReceived(customerInfo: CustomerInfo, created: Boolean) {
                updateTierFromCustomerInfo(customerInfo)
            }

            override fun onError(error: PurchasesError) {
                // Silently fail - RevenueCat will use anonymous ID
            }
        })
    }

    private fun loadCurrentTier() {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            try {
                val status = subscriptionRepository.getSubscriptionStatus(userId)
                _uiState.update { it.copy(currentTier = status.tier) }
            } catch (_: Exception) {}
        }
    }

    private fun loadOfferings() {
        _uiState.update { it.copy(isLoading = true) }
        purchases.getOfferingsWith(
            onError = { error ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "Failed to load offerings: ${error.message}"
                    )
                }
            },
            onSuccess = { offerings ->
                val currentOffering = offerings.current
                val packages = currentOffering?.availablePackages ?: emptyList()
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        packages = packages
                    )
                }
            }
        )
    }

    fun purchase(pkg: Package, activity: Activity) {
        _uiState.update { it.copy(isPurchasing = true, errorMessage = null) }

        val purchaseParams = PurchaseParams.Builder(activity, pkg).build()
        purchases.purchase(purchaseParams, object : PurchaseCallback {
            override fun onCompleted(storeTransaction: StoreTransaction, customerInfo: CustomerInfo) {
                val userId = authRepository.currentUser?.uid
                viewModelScope.launch {
                    // Notify backend about the purchase for server-side verification
                    if (userId != null) {
                        try {
                            subscriptionRepository.verifyReceipt(
                                userId = userId,
                                purchaseToken = storeTransaction.purchaseToken
                            )
                        } catch (_: Exception) {
                            // RevenueCat handles the purchase, backend sync can retry
                        }
                    }

                    updateTierFromCustomerInfo(customerInfo)
                    _uiState.update {
                        it.copy(
                            isPurchasing = false,
                            purchaseSuccess = true
                        )
                    }
                }
            }

            override fun onError(error: PurchasesError, userCancelled: Boolean) {
                _uiState.update {
                    it.copy(
                        isPurchasing = false,
                        errorMessage = if (userCancelled) null else "Purchase failed: ${error.message}"
                    )
                }
            }
        })
    }

    private fun updateTierFromCustomerInfo(customerInfo: CustomerInfo) {
        val tier = when {
            customerInfo.entitlements["pro"]?.isActive == true -> "pro"
            customerInfo.entitlements["team"]?.isActive == true -> "team"
            customerInfo.entitlements["enterprise"]?.isActive == true -> "enterprise"
            else -> "free"
        }
        _uiState.update { it.copy(currentTier = tier) }
    }

    fun restorePurchases() {
        _uiState.update { it.copy(isLoading = true) }
        purchases.restorePurchases(
            callback = object : com.revenuecat.purchases.interfaces.ReceiveCustomerInfoCallback {
                override fun onReceived(customerInfo: CustomerInfo) {
                    updateTierFromCustomerInfo(customerInfo)
                    _uiState.update { it.copy(isLoading = false) }
                }

                override fun onError(error: PurchasesError) {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = "Restore failed: ${error.message}"
                        )
                    }
                }
            }
        )
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun clearPurchaseSuccess() {
        _uiState.update { it.copy(purchaseSuccess = false) }
    }
}
