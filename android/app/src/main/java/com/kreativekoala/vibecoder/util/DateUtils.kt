package com.kreativekoala.vibecoder.util

import android.text.format.DateUtils
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

object DateUtil {

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    private val isoFormatWithMillis = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun relativeTimeString(isoDate: String?): String {
        if (isoDate == null) return ""

        val date = try {
            isoFormatWithMillis.parse(isoDate)
        } catch (_: Exception) {
            try {
                isoFormat.parse(isoDate.removeSuffix("Z").substringBefore("+"))
            } catch (_: Exception) {
                return ""
            }
        } ?: return ""

        return DateUtils.getRelativeTimeSpanString(
            date.time,
            System.currentTimeMillis(),
            DateUtils.MINUTE_IN_MILLIS,
            DateUtils.FORMAT_ABBREV_RELATIVE
        ).toString()
    }
}
