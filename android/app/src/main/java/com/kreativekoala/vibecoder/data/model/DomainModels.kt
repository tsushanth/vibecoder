package com.kreativekoala.vibecoder.data.model

import com.google.gson.annotations.SerializedName

data class AddDomainRequest(val userId: String, val domain: String)
data class VerifyDomainRequest(val userId: String)

/** Every field nullable: Gson does not apply Kotlin defaults, and the backend may add/omit fields. */
data class ApexRecords(
    val a: List<String>? = null,
    val aaaa: List<String>? = null
)

data class AddDomainResponse(
    val success: Boolean = false,
    val domain: String? = null,
    val status: String? = null,
    @SerializedName("cnameTarget") val cnameTarget: String? = null,
    @SerializedName("verificationToken") val verificationToken: String? = null,
    @SerializedName("apexRecords") val apexRecords: ApexRecords? = null,
    @SerializedName("txtRecord") val txtRecord: String? = null,
    @SerializedName("txtValue") val txtValue: String? = null,
    val error: String? = null
)

data class VerifyDomainResponse(
    val success: Boolean = false,
    val status: String? = null,
    val message: String? = null,
    @SerializedName("cnameExpected") val cnameExpected: String? = null,
    @SerializedName("txtExpected") val txtExpected: String? = null,
    val error: String? = null
)

data class DomainInfoResponse(
    val success: Boolean = false,
    @SerializedName("hasDomain") val hasDomain: Boolean = false,
    val domain: String? = null,
    val status: String? = null,
    @SerializedName("cnameTarget") val cnameTarget: String? = null,
    @SerializedName("txtRecord") val txtRecord: String? = null,
    @SerializedName("txtValue") val txtValue: String? = null,
    @SerializedName("apexRecords") val apexRecords: ApexRecords? = null
)

data class RemoveDomainResponse(
    val success: Boolean = false,
    val removed: Boolean = false
)
