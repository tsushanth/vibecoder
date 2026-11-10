package com.kreativekoala.vibecoder.ui.apps.explore

import com.kreativekoala.vibecoder.data.repository.ExploreListingApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ExploreListingState(
    /** False until the current setting is known; the switch is not shown before that. */
    val ready: Boolean = false,
    /** Whether the app is shown on the public Explore page. New builds are not listed until the creator turns this on. */
    val listed: Boolean = false,
    val saving: Boolean = false,
    val failed: Boolean = false
)

/**
 * State holder for the "Show on Explore" switch on a project. The switch moves only after the server has accepted the change, so
 * it never claims an app is listed when it is not. Inject a fake [ExploreListingApi] and a TestScope in unit tests.
 */
class ExploreListingController(
    private val api: ExploreListingApi,
    private val scope: CoroutineScope
) {
    private val _state = MutableStateFlow(ExploreListingState())
    val state: StateFlow<ExploreListingState> = _state.asStateFlow()

    private var projectId: String? = null

    /** [known] is the setting when the caller already has it, which saves a read. */
    fun load(projectId: String, known: Boolean? = null) {
        if (this.projectId == projectId && _state.value.ready) return
        this.projectId = projectId
        if (known != null) {
            _state.value = ExploreListingState(ready = true, listed = known)
            return
        }
        _state.value = ExploreListingState()
        scope.launch {
            val listed = api.isListed(projectId)
            // ignore an answer for a project we have since moved away from
            if (this@ExploreListingController.projectId != projectId) return@launch
            if (listed != null) _state.value = ExploreListingState(ready = true, listed = listed)
        }
    }

    fun setListed(next: Boolean) {
        val id = projectId ?: return
        val s = _state.value
        if (!s.ready || s.saving || s.listed == next) return
        _state.update { it.copy(saving = true, failed = false) }
        scope.launch {
            val ok = api.setListed(id, next)
            if (projectId != id) return@launch
            _state.update { if (ok) it.copy(listed = next, saving = false) else it.copy(saving = false, failed = true) }
        }
    }
}
