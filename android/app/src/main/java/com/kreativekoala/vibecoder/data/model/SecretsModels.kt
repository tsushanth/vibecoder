package com.kreativekoala.vibecoder.data.model

/** Creator keys for a generated app. Names and hints only: the backend never returns a value. Every field nullable, as Gson ignores Kotlin defaults. */
data class SecretValueRequest(val value: String) {
    // a request body must never print its value, whoever logs it
    override fun toString() = "SecretValueRequest(value=<hidden>)"
}

data class SecretInfo(val name: String? = null, val updatedAt: String? = null)

data class RequiredSecret(val name: String? = null, val connectors: List<String>? = null, val purpose: String? = null)

data class SecretsPayInfo(val webhookUrl: String? = null)

data class SecretsResponse(
    val secrets: List<SecretInfo>? = null,
    val required: List<RequiredSecret>? = null,
    val pay: SecretsPayInfo? = null
)
