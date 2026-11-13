package com.kreativekoala.vibecoder.util

import com.kreativekoala.ratingkit.RatingPolicy

/**
 * VibeBuild's RatingKit schedule. The portfolio default (2 days since first open + 2 moments) is out of reach for this
 * audience, since most users never come back on a later day. So: one finished build the user actually opened is enough, with no
 * day gate. Everything else stays at the portfolio standard: a 2-hour quiet period after a visible error and at most 3 asks per
 * install, with shorter gaps (30, then 60 days) than the default 60/120.
 */
object RatingConfig {
    val VIBEBUILD = RatingPolicy.Config(
        minMoments = 1,
        minDaysSinceFirstOpen = 0,
        errorQuietHours = 2,
        maxAttempts = 3,
        gapsDays = listOf(30, 60),
    )
}
