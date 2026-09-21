package com.kreativekoala.vibecoder.ui.apps.domain

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.repository.AuthRepository
import com.kreativekoala.vibecoder.data.repository.DomainRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class CustomDomainViewModel @Inject constructor(
    domainRepository: DomainRepository,
    authRepository: AuthRepository
) : ViewModel() {
    val controller = CustomDomainController(
        api = domainRepository,
        scope = viewModelScope,
        userIdProvider = { authRepository.currentUser?.uid }
    )

    override fun onCleared() = controller.cancel()
}
