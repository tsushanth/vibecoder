package com.kreativekoala.vibecoder.ui.apps.domain

import com.kreativekoala.vibecoder.data.model.ApexRecords
import com.kreativekoala.vibecoder.data.repository.DomainApi
import com.kreativekoala.vibecoder.data.repository.DomainFailure
import com.kreativekoala.vibecoder.data.repository.DomainResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class DomainStatus {
    NONE, PENDING, DNS_VERIFIED, SSL_PROVISIONING, ACTIVE;

    companion object {
        fun parse(s: String?): DomainStatus = when (s?.lowercase()) {
            "active" -> ACTIVE
            "ssl_provisioning" -> SSL_PROVISIONING
            "dns_verified" -> DNS_VERIFIED
            "pending", null -> PENDING
            else -> PENDING // unknown future status: treat as not yet live
        }
    }
}

enum class DomainWork { IDLE, LOADING, ADDING, VERIFYING, REMOVING }

sealed class DomainError {
    data class Validation(val message: String) : DomainError()
    data object AlreadyRegistered : DomainError()
    data object Network : DomainError()
    /** DNS not visible yet; carries what we expected so the user can compare with their DNS panel. */
    data class DnsNotFound(val expectedCname: String?, val expectedTxt: String?) : DomainError()
    data object PollTimeout : DomainError()
    data class Other(val message: String) : DomainError()
}

data class CustomDomainState(
    val work: DomainWork = DomainWork.LOADING,
    val input: String = "",
    val domain: String? = null,
    val status: DomainStatus = DomainStatus.NONE,
    val cnameTarget: String? = null,
    val apexA: List<String> = emptyList(),
    val apexAaaa: List<String> = emptyList(),
    val txtRecord: String? = null,
    val txtValue: String? = null,
    val upgradeRequired: Boolean = false,
    val confirmingRemove: Boolean = false,
    val polling: Boolean = false,
    val error: DomainError? = null
) {
    val hasDomain get() = domain != null && status != DomainStatus.NONE
    val isApex get() = domain?.let { DomainValidator.isApex(it) } ?: false
    val isLive get() = status == DomainStatus.ACTIVE
}

object DomainValidator {
    private val label = Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
    private val secondLevel = setOf("co", "com", "org", "net", "gov", "ac", "edu", "or", "ne")

    /** Returns normalized domain (lowercase, no scheme/path/port/trailing dot) or null if invalid. */
    fun normalize(raw: String): String {
        var s = raw.trim().lowercase()
        s = s.removePrefix("https://").removePrefix("http://")
        s = s.substringBefore('/').substringBefore('?').substringBefore('#').substringBefore(':')
        return s.trimEnd('.')
    }

    /** null when valid, else a user-facing message. */
    fun error(raw: String): String? {
        val d = normalize(raw)
        if (d.isEmpty()) return "Enter a domain like www.example.com"
        if (d.length > 253) return "That domain is too long"
        val labels = d.split('.')
        if (labels.size < 2) return "Include the extension, like example.com"
        if (labels.any { !label.matches(it) }) return "Use only letters, numbers and hyphens"
        val tld = labels.last()
        if (tld.length < 2 || tld.all { it.isDigit() }) return "That doesn't look like a valid domain"
        if (d == "vibebuild.cc" || d.endsWith(".vibebuild.cc")) return "Use your own domain, not a vibebuild.cc address"
        return null
    }

    /** Apex/root = registrable name itself (example.com, example.co.uk); heuristic without a full PSL. */
    fun isApex(domain: String): Boolean {
        val labels = domain.split('.')
        return labels.size == 2 || (labels.size == 3 && labels[1] in secondLevel && labels[2].length == 2)
    }
}

/**
 * Framework-free state machine for the "Custom domain" section. Inject a fake [DomainApi] and a
 * TestScope in unit tests; polling uses [delay] so virtual time works.
 */
class CustomDomainController(
    private val api: DomainApi,
    private val scope: CoroutineScope,
    private val userIdProvider: () -> String?,
    private val pollIntervalMs: Long = 5_000,
    private val maxPollMs: Long = 120_000
) {
    private val _state = MutableStateFlow(CustomDomainState())
    val state: StateFlow<CustomDomainState> = _state.asStateFlow()

    private var deploymentId: String? = null
    private var pollJob: Job? = null

    fun load(deploymentId: String) {
        if (this.deploymentId == deploymentId && _state.value.work != DomainWork.LOADING) return
        this.deploymentId = deploymentId
        val userId = userIdProvider() ?: run { _state.update { it.copy(work = DomainWork.IDLE) }; return }
        _state.update { it.copy(work = DomainWork.LOADING, error = null) }
        scope.launch {
            when (val r = api.get(deploymentId, userId)) {
                is DomainResult.Ok -> {
                    val v = r.value
                    if (v.hasDomain && v.domain != null) {
                        val status = DomainStatus.parse(v.status)
                        _state.update {
                            it.copy(
                                work = DomainWork.IDLE, domain = v.domain, status = status,
                                cnameTarget = v.cnameTarget,
                                apexA = v.apexRecords?.a.orEmpty(), apexAaaa = v.apexRecords?.aaaa.orEmpty(),
                                txtRecord = v.txtRecord ?: "_vibebuilder.${v.domain}", txtValue = v.txtValue
                            )
                        }
                        if (status == DomainStatus.DNS_VERIFIED || status == DomainStatus.SSL_PROVISIONING) startPolling()
                    } else {
                        _state.update { it.copy(work = DomainWork.IDLE, status = DomainStatus.NONE, domain = null) }
                    }
                }
                is DomainResult.Failed -> _state.update { it.copy(work = DomainWork.IDLE, error = r.failure.toError()) }
            }
        }
    }

    fun onInputChanged(text: String) = _state.update { it.copy(input = text, error = null) }

    fun add() {
        val id = deploymentId ?: return
        val userId = userIdProvider() ?: return
        if (_state.value.work != DomainWork.IDLE) return
        val msg = DomainValidator.error(_state.value.input)
        if (msg != null) { _state.update { it.copy(error = DomainError.Validation(msg)) }; return }
        val domain = DomainValidator.normalize(_state.value.input)
        _state.update { it.copy(work = DomainWork.ADDING, error = null) }
        scope.launch {
            when (val r = api.add(id, userId, domain)) {
                is DomainResult.Ok -> {
                    val v = r.value
                    val d = v.domain ?: domain
                    _state.update {
                        it.copy(
                            work = DomainWork.IDLE, domain = d, status = DomainStatus.parse(v.status),
                            cnameTarget = v.cnameTarget,
                            apexA = v.apexRecords?.a.orEmpty(), apexAaaa = v.apexRecords?.aaaa.orEmpty(),
                            txtRecord = v.txtRecord ?: "_vibebuilder.$d",
                            txtValue = v.txtValue ?: v.verificationToken,
                            upgradeRequired = false
                        )
                    }
                }
                is DomainResult.Failed -> {
                    val f = r.failure
                    _state.update {
                        it.copy(
                            work = DomainWork.IDLE,
                            upgradeRequired = f is DomainFailure.UpgradeRequired,
                            error = if (f is DomainFailure.UpgradeRequired) null else f.toError()
                        )
                    }
                }
            }
        }
    }

    /** User pressed Verify. One check; keeps polling only if DNS passed and SSL is in progress. */
    fun verify() {
        if (_state.value.work != DomainWork.IDLE || !_state.value.hasDomain) return
        pollJob?.cancel()
        pollJob = scope.launch {
            _state.update { it.copy(error = null, polling = true) }
            var elapsed = 0L
            while (true) {
                val cont = verifyOnce()
                if (!cont) break
                if (elapsed >= maxPollMs) {
                    _state.update { it.copy(error = DomainError.PollTimeout) }
                    break
                }
                delay(pollIntervalMs)
                elapsed += pollIntervalMs
            }
            _state.update { it.copy(polling = false, work = DomainWork.IDLE) }
        }
    }

    private fun startPolling() = verify()

    /** @return true if we should keep polling. */
    private suspend fun verifyOnce(): Boolean {
        val id = deploymentId ?: return false
        val userId = userIdProvider() ?: return false
        _state.update { it.copy(work = DomainWork.VERIFYING) }
        return when (val r = api.verify(id, userId)) {
            is DomainResult.Ok -> {
                val v = r.value
                val status = DomainStatus.parse(v.status)
                _state.update { it.copy(work = DomainWork.IDLE, status = status) }
                when (status) {
                    DomainStatus.ACTIVE -> false
                    DomainStatus.DNS_VERIFIED, DomainStatus.SSL_PROVISIONING -> true
                    else -> {
                        val s = _state.value
                        _state.update {
                            it.copy(error = DomainError.DnsNotFound(
                                expectedCname = v.cnameExpected ?: s.cnameTarget,
                                expectedTxt = v.txtExpected ?: s.txtValue
                            ))
                        }
                        false
                    }
                }
            }
            is DomainResult.Failed -> {
                _state.update { it.copy(work = DomainWork.IDLE, error = r.failure.toError()) }
                false
            }
        }
    }

    fun requestRemove() = _state.update { it.copy(confirmingRemove = true) }
    fun cancelRemove() = _state.update { it.copy(confirmingRemove = false) }

    fun confirmRemove() {
        val id = deploymentId ?: return
        val userId = userIdProvider() ?: return
        pollJob?.cancel()
        _state.update { it.copy(confirmingRemove = false, work = DomainWork.REMOVING, polling = false, error = null) }
        scope.launch {
            when (val r = api.remove(id, userId)) {
                is DomainResult.Ok -> _state.value = CustomDomainState(work = DomainWork.IDLE)
                is DomainResult.Failed -> _state.update { it.copy(work = DomainWork.IDLE, error = r.failure.toError()) }
            }
        }
    }

    fun cancel() { pollJob?.cancel() }

    private fun DomainFailure.toError(): DomainError = when (this) {
        DomainFailure.UpgradeRequired -> DomainError.Other("Custom domains are a Pro feature")
        is DomainFailure.InvalidDomain -> DomainError.Validation(message)
        DomainFailure.AlreadyRegistered -> DomainError.AlreadyRegistered
        DomainFailure.Network -> DomainError.Network
        is DomainFailure.Other -> DomainError.Other(message)
    }
}
