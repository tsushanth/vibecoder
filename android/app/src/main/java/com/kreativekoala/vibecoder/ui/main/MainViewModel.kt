package com.kreativekoala.vibecoder.ui.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    private val api: VibeBuildApi
) : ViewModel() {

    private val _isSystemDown = MutableStateFlow(false)
    val isSystemDown: StateFlow<Boolean> = _isSystemDown.asStateFlow()

    private val _systemMessage = MutableStateFlow<String?>(null)
    val systemMessage: StateFlow<String?> = _systemMessage.asStateFlow()

    init {
        startStatusPolling()
    }

    private fun startStatusPolling() {
        viewModelScope.launch {
            while (isActive) {
                try {
                    val status = api.getSystemStatus()
                    _isSystemDown.value = !status.operational
                    _systemMessage.value = status.message
                } catch (_: Exception) {
                    // On error, don't change current state
                }
                delay(5 * 60 * 1000L) // Poll every 5 minutes
            }
        }
    }
}
