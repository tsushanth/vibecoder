package com.kreativekoala.vibecoder.ui.apps.keys

import com.kreativekoala.vibecoder.data.repository.SecretsApi
import com.kreativekoala.vibecoder.data.repository.SecretsFailure
import com.kreativekoala.vibecoder.data.repository.SecretsResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class KeysLoad { LOADING, READY, HIDDEN, ERROR }

/** One key an app needs (or has): never a value. */
data class KeyRow(val name: String, val usedBy: List<String>, val purpose: String?, val isSet: Boolean)

enum class KeysError { UNAUTHORIZED, FORBIDDEN, RATE_LIMITED, STORE_DOWN, INVALID_VALUE, NETWORK, OTHER }

enum class KeyNoteKind { SAVED, REMOVED }
data class KeyNote(val name: String, val kind: KeyNoteKind)

data class AppKeysState(
    val load: KeysLoad = KeysLoad.LOADING,
    val rows: List<KeyRow> = emptyList(),
    val hasPay: Boolean = false,
    val payWebhookUrl: String? = null,
    /** Text the creator is typing, by key name. Memory only: never saved, logged or sent anywhere but the save call. */
    val drafts: Map<String, String> = emptyMap(),
    val replacing: String? = null,
    val confirmingRemove: String? = null,
    val busy: String? = null,
    val note: KeyNote? = null,
    val error: KeysError? = null
) {
    val total get() = rows.size
    val missing get() = rows.count { !it.isSet }
    // a state is easy to log by accident; keep the typed values out of it
    override fun toString() = "AppKeysState(load=$load, rows=${rows.size}, busy=$busy, error=$error)"
}

/**
 * Framework-free state machine for the "App keys" section of a project. Inject a fake [SecretsApi] and a TestScope in unit tests.
 * A key's value only ever lives in [AppKeysState.drafts] until the save call succeeds, then it is dropped.
 */
class AppKeysController(
    private val api: SecretsApi,
    private val scope: CoroutineScope
) {
    private val _state = MutableStateFlow(AppKeysState())
    val state: StateFlow<AppKeysState> = _state.asStateFlow()

    private var projectId: String? = null

    fun load(projectId: String, force: Boolean = false) {
        if (!force && this.projectId == projectId && _state.value.load != KeysLoad.ERROR) return
        this.projectId = projectId
        _state.update { AppKeysState(load = KeysLoad.LOADING) }
        scope.launch {
            when (val r = api.list(projectId)) {
                is SecretsResult.Ok -> {
                    val set = r.value.secrets.orEmpty().mapNotNull { it.name }.toSet()
                    val required = r.value.required.orEmpty().mapNotNull { req ->
                        req.name?.let { KeyRow(it, req.connectors.orEmpty(), req.purpose, it in set) }
                    }
                    val known = required.map { it.name }.toSet()
                    val extras = set.filter { it !in known }.sorted().map { KeyRow(it, emptyList(), null, true) }
                    val rows = required + extras
                    // an app that needs no key and has none stored has nothing to show
                    _state.update {
                        if (rows.isEmpty()) AppKeysState(load = KeysLoad.HIDDEN)
                        else AppKeysState(load = KeysLoad.READY, rows = rows, hasPay = r.value.pay != null, payWebhookUrl = r.value.pay?.webhookUrl)
                    }
                }
                is SecretsResult.Failed -> _state.update {
                    when (r.failure) {
                        // no key support for this app, or not the creator's app: nothing to show either way
                        SecretsFailure.Unavailable, SecretsFailure.Forbidden -> AppKeysState(load = KeysLoad.HIDDEN)
                        else -> AppKeysState(load = KeysLoad.ERROR, error = r.failure.toError())
                    }
                }
            }
        }
    }

    fun retry() { projectId?.let { load(it, force = true) } }

    fun onDraftChanged(name: String, text: String) =
        _state.update { it.copy(drafts = it.drafts + (name to text), error = null, note = null) }

    fun startReplace(name: String) = _state.update { it.copy(replacing = name, confirmingRemove = null, error = null, note = null) }

    fun cancelEdit(name: String) = _state.update {
        it.copy(replacing = if (it.replacing == name) null else it.replacing, drafts = it.drafts - name, error = null)
    }

    fun save(name: String) {
        val id = projectId ?: return
        val s = _state.value
        if (s.busy != null || s.rows.none { it.name == name }) return
        // pasted keys often carry a trailing newline or space
        val value = s.drafts[name].orEmpty().trim()
        if (value.isEmpty() || value.length > MAX_VALUE) { _state.update { it.copy(error = KeysError.INVALID_VALUE) }; return }
        _state.update { it.copy(busy = name, error = null, note = null, confirmingRemove = null) }
        scope.launch {
            when (val r = api.set(id, name, value)) {
                is SecretsResult.Ok -> _state.update {
                    it.copy(
                        rows = it.rows.map { row -> if (row.name == name) row.copy(isSet = true) else row },
                        drafts = it.drafts - name, replacing = null, busy = null, note = KeyNote(name, KeyNoteKind.SAVED)
                    )
                }
                // the draft stays so the creator can retry without retyping
                is SecretsResult.Failed -> _state.update { it.copy(busy = null, error = r.failure.toError()) }
            }
        }
    }

    fun askRemove(name: String) = _state.update { it.copy(confirmingRemove = name, replacing = null, error = null, note = null) }

    fun cancelRemove() = _state.update { it.copy(confirmingRemove = null) }

    fun confirmRemove(name: String) {
        val id = projectId ?: return
        val s = _state.value
        if (s.busy != null || s.confirmingRemove != name) return
        _state.update { it.copy(busy = name, error = null, note = null) }
        scope.launch {
            when (val r = api.remove(id, name)) {
                is SecretsResult.Ok -> _state.update {
                    it.copy(
                        rows = it.rows.map { row -> if (row.name == name) row.copy(isSet = false) else row },
                        confirmingRemove = null, busy = null, note = KeyNote(name, KeyNoteKind.REMOVED)
                    )
                }
                is SecretsResult.Failed -> _state.update { it.copy(busy = null, confirmingRemove = null, error = r.failure.toError()) }
            }
        }
    }

    /** Drops every typed value, for when the screen goes away. */
    fun clearDrafts() = _state.update { it.copy(drafts = emptyMap(), replacing = null) }

    private fun SecretsFailure.toError() = when (this) {
        SecretsFailure.Unauthorized -> KeysError.UNAUTHORIZED
        SecretsFailure.Forbidden -> KeysError.FORBIDDEN
        SecretsFailure.RateLimited -> KeysError.RATE_LIMITED
        SecretsFailure.StoreDown -> KeysError.STORE_DOWN
        SecretsFailure.InvalidValue -> KeysError.INVALID_VALUE
        SecretsFailure.Network -> KeysError.NETWORK
        SecretsFailure.Unavailable, is SecretsFailure.Other -> KeysError.OTHER
    }

    companion object { const val MAX_VALUE = 4096 }
}
