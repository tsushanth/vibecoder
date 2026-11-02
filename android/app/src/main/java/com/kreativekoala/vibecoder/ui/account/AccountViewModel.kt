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
import retrofit2.HttpException
import javax.inject.Inject

/** Why deleting the account did not go through. */
enum class DeleteFailure {
    /** The server did not accept the sign-in (HTTP 401): sign in again, then delete. */
    SignInAgain,
    /** Network or server trouble; trying again is fine. */
    Other
}

sealed interface DeleteAccountState {
    data object Idle : DeleteAccountState
    data object Deleting : DeleteAccountState
    /** The account is gone and the local session has ended; the screen should leave to the sign-in flow. */
    data object Deleted : DeleteAccountState
    data class Failed(val reason: DeleteFailure) : DeleteAccountState
}

data class AccountUiState(
    val user: User? = null,
    val subscriptionStatus: SubscriptionStatusResponse? = null,
    val isLoading: Boolean = false,
    val deleteState: DeleteAccountState = DeleteAccountState.Idle
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

    /** Permanently deletes the account on the server (in-app deletion, as Google Play requires). Ignored while one is running. */
    fun deleteAccount() {
        if (_uiState.value.deleteState is DeleteAccountState.Deleting) return
        _uiState.update { it.copy(deleteState = DeleteAccountState.Deleting) }
        viewModelScope.launch {
            val result = try {
                authRepository.deleteAccount()
                DeleteAccountState.Deleted
            } catch (e: CancellationException) {
                throw e
            } catch (e: HttpException) {
                DeleteAccountState.Failed(if (e.code() == 401) DeleteFailure.SignInAgain else DeleteFailure.Other)
            } catch (_: Exception) {
                DeleteAccountState.Failed(DeleteFailure.Other)
            }
            _uiState.update { it.copy(deleteState = result) }
        }
    }

    /** Closes the delete dialog or its error. A deletion that is running is not interrupted. */
    fun dismissDeleteError() {
        _uiState.update { if (it.deleteState is DeleteAccountState.Deleting) it else it.copy(deleteState = DeleteAccountState.Idle) }
    }
}
