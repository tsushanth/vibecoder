package com.kreativekoala.vibecoder.ui.account

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.android.billingclient.api.*
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.SubscriptionRepository
import com.kreativekoala.vibecoder.util.Constants
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SubscriptionUiState(
    val products: List<ProductDetails> = emptyList(),
    val currentTier: String = "free",
    val isPurchasing: Boolean = false,
    val isLoading: Boolean = false,
    val purchaseSuccess: Boolean = false,
    val errorMessage: String? = null
)

@HiltViewModel
class SubscriptionViewModel @Inject constructor(
    private val billingClient: BillingClient,
    private val authRepository: AuthRepository,
    private val subscriptionRepository: SubscriptionRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SubscriptionUiState())
    val uiState: StateFlow<SubscriptionUiState> = _uiState.asStateFlow()

    init {
        connectBilling()
        loadCurrentTier()
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

    private fun connectBilling() {
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    queryProducts()
                }
            }

            override fun onBillingServiceDisconnected() {
                // Retry connection
            }
        })
    }

    private fun queryProducts() {
        val productList = listOf(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(Constants.PRODUCT_PRO_MONTHLY)
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(Constants.PRODUCT_PRO_YEARLY)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        )

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(productList)
            .build()

        billingClient.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                _uiState.update { it.copy(products = productDetailsList) }
            }
        }
    }

    fun purchase(productDetails: ProductDetails, activity: Activity) {
        val offerToken = productDetails.subscriptionOfferDetails
            ?.firstOrNull()?.offerToken ?: return

        val billingFlowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails)
                        .setOfferToken(offerToken)
                        .build()
                )
            )
            .build()

        _uiState.update { it.copy(isPurchasing = true) }
        billingClient.launchBillingFlow(activity, billingFlowParams)
    }

    fun handlePurchaseResult(purchases: List<Purchase>?) {
        val userId = authRepository.currentUser?.uid ?: return

        purchases?.forEach { purchase ->
            if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                viewModelScope.launch {
                    try {
                        // Verify with backend
                        subscriptionRepository.verifyReceipt(
                            userId = userId,
                            purchaseToken = purchase.purchaseToken
                        )

                        // Acknowledge purchase
                        if (!purchase.isAcknowledged) {
                            val ackParams = AcknowledgePurchaseParams.newBuilder()
                                .setPurchaseToken(purchase.purchaseToken)
                                .build()
                            billingClient.acknowledgePurchase(ackParams) { }
                        }

                        _uiState.update {
                            it.copy(
                                isPurchasing = false,
                                purchaseSuccess = true,
                                currentTier = "pro"
                            )
                        }
                    } catch (e: Exception) {
                        _uiState.update {
                            it.copy(
                                isPurchasing = false,
                                errorMessage = "Verification failed: ${e.message}"
                            )
                        }
                    }
                }
            }
        }
    }
}
