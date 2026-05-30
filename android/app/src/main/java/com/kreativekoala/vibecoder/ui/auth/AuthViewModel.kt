package com.kreativekoala.vibecoder.ui.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.local.UserPreferences
import com.kreativekoala.vibecoder.data.model.User
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.service.FacebookSDKHelper
import com.kreativekoala.vibecoder.service.FCMTokenManager
import com.kreativekoala.vibecoder.service.FirebaseAnalyticsHelper
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val userPreferences: UserPreferences,
    private val fcmTokenManager: FCMTokenManager
) : ViewModel() {

    private val _isAuthenticated = MutableStateFlow(authRepository.currentUser != null)
    val isAuthenticated: StateFlow<Boolean> = _isAuthenticated.asStateFlow()

    /** True once the auth session has been checked at least once (avoids flash of Landing screen). */
    private val _isAuthResolved = MutableStateFlow(false)
    val isAuthResolved: StateFlow<Boolean> = _isAuthResolved.asStateFlow()

    private val _currentUser = MutableStateFlow<User?>(null)
    val currentUser: StateFlow<User?> = _currentUser.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    init {
        viewModelScope.launch {
            authRepository.observeAuthState().collect { authUser ->
                _isAuthenticated.value = authUser != null
                _isAuthResolved.value = true
                if (authUser != null && _currentUser.value == null) {
                    try {
                        val user = authRepository.fetchUserProfile(authUser.uid)
                        _currentUser.value = user
                        userPreferences.saveUser(user.userId, user.displayName)
                    } catch (_: Exception) {
                        // Profile fetch may fail on first launch before registration
                    }
                }
            }
        }
    }

    fun signInWithGoogle(context: Context) {
        viewModelScope.launch {
            _isLoading.value = true
            _errorMessage.value = null
            try {
                val user = authRepository.signInWithGoogle(context)
                _currentUser.value = user
                userPreferences.saveUser(user.userId, user.displayName)
                fcmTokenManager.registerTokenForUser(user.userId)
                FirebaseAnalyticsHelper.logLogin("google")
                // FacebookSDKHelper.logSignUp dedupes per install — safe to call
                // on every Google sign-in; only fires for first-time users.
                FacebookSDKHelper.logSignUp("google")
            } catch (e: Exception) {
                _errorMessage.value = e.message ?: "Sign in failed"
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun signInWithEmail(email: String, password: String) {
        viewModelScope.launch {
            _isLoading.value = true
            _errorMessage.value = null
            try {
                val user = authRepository.signInWithEmail(email, password)
                _currentUser.value = user
                userPreferences.saveUser(user.userId, user.displayName)
                fcmTokenManager.registerTokenForUser(user.userId)
                FirebaseAnalyticsHelper.logLogin("email")
            } catch (e: Exception) {
                _errorMessage.value = e.message ?: "Sign in failed"
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun signUpWithEmail(email: String, password: String, displayName: String?) {
        viewModelScope.launch {
            _isLoading.value = true
            _errorMessage.value = null
            try {
                val user = authRepository.signUpWithEmail(email, password, displayName)
                _currentUser.value = user
                userPreferences.saveUser(user.userId, user.displayName)
                fcmTokenManager.registerTokenForUser(user.userId)
                FirebaseAnalyticsHelper.logSignUp("email")
                FacebookSDKHelper.logSignUp("email")
            } catch (e: Exception) {
                _errorMessage.value = e.message ?: "Sign up failed"
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            authRepository.signOut()
            _currentUser.value = null
            userPreferences.clearUser()
        }
    }

    fun clearError() {
        _errorMessage.value = null
    }
}
