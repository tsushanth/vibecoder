package com.kreativekoala.vibecoder.ui.apps.keys

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.repository.SecretsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class AppKeysViewModel @Inject constructor(
    secretsRepository: SecretsRepository
) : ViewModel() {
    val controller = AppKeysController(api = secretsRepository, scope = viewModelScope)

    override fun onCleared() = controller.clearDrafts()
}
