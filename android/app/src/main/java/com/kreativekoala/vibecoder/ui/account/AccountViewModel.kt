package com.kreativekoala.vibecoder.ui.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.SubscriptionStatusResponse
import com.kreativekoala.vibecoder.data.model.User
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.toLocalUser
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.data.repository.SubscriptionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AccountUiState(
    val user: User? = null,
    val subscriptionStatus: SubscriptionStatusResponse? = null,
    val isLoading: Boolean = false
)

@HiltViewModel
class AccountViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val subscriptionRepository: SubscriptionRepository,
    private val projectRepository: ProjectRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AccountUiState())
    val uiState: StateFlow<AccountUiState> = _uiState.asStateFlow()

    init {
        loadProfile()
    }

    fun loadProfile() {
        val userId = authRepository.currentUser?.uid ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // The backend has no profile endpoint, so the name and email come from the session.
            val base = authRepository.currentUser?.toLocalUser() ?: User(userId = userId)
            _uiState.update { it.copy(user = base) }

            try {
                val count = projectRepository.countMyProjects(userId)
                _uiState.update { state -> state.copy(user = state.user?.copy(totalProjects = count)) }
            } catch (_: Exception) {}

            try {
                val status = subscriptionRepository.getSubscriptionStatus(userId)
                _uiState.update { it.copy(subscriptionStatus = status) }
            } catch (_: Exception) {}

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    /**
     * Re-reads the server's subscription status, for when the screen comes back after a purchase or restore. The server entitlement
     * comes from the RevenueCat webhook, which can land a few seconds after the store confirms, so when the app already knows the
     * user paid ([expectPaid]) a "free" answer is re-checked a few times before it is shown as final.
     */
    fun refreshSubscription(expectPaid: Boolean = false) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            val attempts = if (expectPaid) PAID_SYNC_ATTEMPTS else 1
            for (i in 1..attempts) {
                try {
                    val status = subscriptionRepository.getSubscriptionStatus(userId)
                    _uiState.update { it.copy(subscriptionStatus = status) }
                    if (status.tier != "free") return@launch
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {}
                if (i < attempts) delay(PAID_SYNC_DELAY_MS)
            }
        }
    }

    companion object {
        private const val PAID_SYNC_ATTEMPTS = 5
        private const val PAID_SYNC_DELAY_MS = 3_000L
    }

    fun signOut() {
        viewModelScope.launch {
            authRepository.signOut()
        }
    }
}
