package com.kreativekoala.vibecoder.ui.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.SubscriptionStatusResponse
import com.kreativekoala.vibecoder.data.model.User
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.ProjectRepository
import com.kreativekoala.vibecoder.data.repository.SubscriptionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
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

            // The backend has no profile endpoint, so fetchUserProfile 404s. Fall back
            // to the local session so the screen shows the real name and email.
            val fetched = try { authRepository.fetchUserProfile(userId) } catch (_: Exception) { null }
            val local = authRepository.currentUser
            val base = fetched ?: User(
                userId = userId,
                email = local?.email,
                displayName = local?.displayName ?: local?.email?.substringBefore('@'),
                avatarUrl = local?.avatarUrl
            )
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

    fun signOut() {
        viewModelScope.launch {
            authRepository.signOut()
        }
    }
}
