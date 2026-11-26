package com.kreativekoala.vibecoder.util

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

object VisitDates {
    /** "2026-11-26" in the reader's date format, or null when it is not a date. */
    fun display(isoDay: String?, locale: Locale = Locale.getDefault()): String? =
        runCatching { LocalDate.parse(isoDay).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) }.getOrNull()
}
