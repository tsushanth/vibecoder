package com.kreativekoala.vibecoder.ui.create

/**
 * The longest app description the server takes: POST /api/projects/generate refuses `prompt.length > 2000`, counted in UTF-16
 * units, which is what Kotlin's `length` counts too.
 */
object PromptLimit {
    const val MAX_CHARS = 2000

    /** What the box holds after an edit; [cut] when some of what was typed or pasted did not fit. */
    data class Result(val text: String, val cut: Boolean)

    /** Text already in the box stays: only the newly added part of [new] is shortened to what still fits. */
    fun apply(old: String, new: String, max: Int = MAX_CHARS): Result {
        if (new.length <= max) return Result(new, cut = false)
        var head = old.commonPrefixWith(new).length
        var tail = minOf(old.commonSuffixWith(new).length, new.length - head, old.length - head)
        // Never split a two-unit character (emoji) at either edge.
        if (head > 0 && new[head - 1].isHighSurrogate()) head--
        if (tail > 0 && new[new.length - tail].isLowSurrogate()) tail--
        val added = new.substring(head, new.length - tail).takeWhole(max - head - tail)
        return Result((new.substring(0, head) + added + new.substring(new.length - tail)).takeWhole(max), cut = true)
    }

    private fun String.takeWhole(n: Int): String {
        val cut = take(n.coerceAtLeast(0))
        return if (cut.length < length && cut.isNotEmpty() && cut.last().isHighSurrogate()) cut.dropLast(1) else cut
    }
}
