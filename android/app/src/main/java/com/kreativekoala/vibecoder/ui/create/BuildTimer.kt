package com.kreativekoala.vibecoder.ui.create

/**
 * The elapsed-time label on the build card. The start time is a wall-clock timestamp that is 0 when it is not known (for example a
 * finished build restored after the app restarted), and subtracting it from the current time produced a "build time" of tens of
 * millions of minutes. An unknown, negative or implausible span is reported as null and the label is hidden.
 */
object BuildTimer {
    /** No build runs this long (the app gives up after 12 minutes); anything larger means a bad timestamp. */
    const val MAX_PLAUSIBLE_SECONDS = 24 * 60 * 60L

    fun elapsedSeconds(startMs: Long, endMs: Long): Long? {
        if (startMs <= 0L || endMs <= 0L) return null
        val seconds = (endMs - startMs) / 1000
        return seconds.takeIf { it in 0..MAX_PLAUSIBLE_SECONDS }
    }

    /** "m:ss" (or "h:mm:ss" from an hour), or null when there is nothing sensible to show. */
    fun format(seconds: Long?): String? {
        if (seconds == null || seconds < 0 || seconds > MAX_PLAUSIBLE_SECONDS) return null
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
    }

    fun label(startMs: Long, endMs: Long): String? = format(elapsedSeconds(startMs, endMs))
}
