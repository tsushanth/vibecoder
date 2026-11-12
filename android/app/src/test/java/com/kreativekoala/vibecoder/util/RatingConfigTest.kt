package com.kreativekoala.vibecoder.util

import com.kreativekoala.ratingkit.RatingPolicy
import com.kreativekoala.ratingkit.RatingPolicy.Decision
import com.kreativekoala.ratingkit.RatingPolicy.Trigger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

/** VibeBuild's rating schedule must be reachable by a user who builds one app and never comes back. */
class RatingConfigTest {
    private val cfg = RatingConfig.VIBEBUILD
    private val day = TimeUnit.DAYS.toMillis(1)
    private val hour = TimeUnit.HOURS.toMillis(1)
    private val t0 = 1_800_000_000_000L

    private fun state(moments: Int = 1, attempts: Int = 0, lastAttemptAt: Long = 0L, lastErrorAt: Long = 0L) =
        RatingPolicy.State(firstOpenAt = t0, moments = moments, attempts = attempts, lastAttemptAt = lastAttemptAt, lastErrorAt = lastErrorAt)

    @Test fun config_values() {
        assertEquals(1, cfg.minMoments)
        assertEquals(0, cfg.minDaysSinceFirstOpen)
        assertEquals(2, cfg.errorQuietHours)
        assertEquals(3, cfg.maxAttempts)
        assertEquals(listOf(30, 60), cfg.gapsDays)
    }

    @Test fun one_moment_in_the_first_session_asks() {
        assertEquals(Decision.Ask, RatingPolicy.decide(state(), t0 + 10 * 60_000L, cfg, Trigger.MOMENT))
    }

    @Test fun the_portfolio_default_would_have_waited_for_the_same_user() {
        val d = RatingPolicy.decide(state(), t0 + 10 * 60_000L, RatingPolicy.Config(), Trigger.MOMENT)
        assertTrue(d is Decision.Wait)
    }

    @Test fun no_moment_means_no_ask() {
        val d = RatingPolicy.decide(state(moments = 0), t0 + day, cfg, Trigger.MOMENT)
        assertEquals(Decision.Wait("not_enough_moments"), d)
    }

    @Test fun purchase_still_asks_without_a_moment() {
        assertEquals(Decision.Ask, RatingPolicy.decide(state(moments = 0), t0 + hour, cfg, Trigger.PURCHASE))
    }

    @Test fun quiet_for_two_hours_after_an_error_then_asks() {
        val err = t0 + hour
        assertEquals(Decision.Wait("recent_error"), RatingPolicy.decide(state(lastErrorAt = err), err + hour, cfg, Trigger.MOMENT))
        assertEquals(Decision.Ask, RatingPolicy.decide(state(lastErrorAt = err), err + 2 * hour, cfg, Trigger.MOMENT))
    }

    @Test fun gaps_are_30_then_60_days_and_three_asks_max() {
        val first = t0 + day
        assertEquals(Decision.Wait("gap"), RatingPolicy.decide(state(attempts = 1, lastAttemptAt = first), first + 29 * day, cfg, Trigger.MOMENT))
        assertEquals(Decision.Ask, RatingPolicy.decide(state(attempts = 1, lastAttemptAt = first), first + 30 * day, cfg, Trigger.MOMENT))
        assertEquals(Decision.Wait("gap"), RatingPolicy.decide(state(attempts = 2, lastAttemptAt = first), first + 59 * day, cfg, Trigger.MOMENT))
        assertEquals(Decision.Ask, RatingPolicy.decide(state(attempts = 2, lastAttemptAt = first), first + 60 * day, cfg, Trigger.MOMENT))
        assertEquals(Decision.Wait("max_attempts"), RatingPolicy.decide(state(attempts = 3, lastAttemptAt = first), first + 365 * day, cfg, Trigger.MOMENT))
    }

    @Test fun no_first_open_never_asks() {
        val d = RatingPolicy.decide(RatingPolicy.State(moments = 5), t0, cfg, Trigger.MOMENT)
        assertEquals(Decision.Wait("no_first_open"), d)
    }
}
