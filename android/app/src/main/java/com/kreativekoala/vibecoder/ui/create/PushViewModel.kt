package com.kreativekoala.vibecoder.ui.create

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.vibecoder.data.model.PushOpenRequest
import com.kreativekoala.vibecoder.data.remote.VibeBuildApi
import com.kreativekoala.vibecoder.service.FCMTokenManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PushViewModel @Inject constructor(
    private val tokens: FCMTokenManager,
    private val api: VibeBuildApi
) : ViewModel() {
    fun onNotificationsAllowed() = tokens.refresh()

    /** Counts a tapped notification. Best effort. */
    fun onOpened(kind: String) {
        viewModelScope.launch {
            try {
                api.pushOpened(PushOpenRequest(kind))
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            }
        }
    }
}
