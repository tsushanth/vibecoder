package com.kreativekoala.vibecoder.ui.paywall

import org.junit.Assert.*
import org.junit.Test

class PaywallPlansTest {
    private fun plan(id: String, period: PlanPeriod, trial: Int? = null) = PaywallPlan(id, period, "$1.00", trial)

    @Test fun periodsMapFromTheStoreUnitNames() {
        assertEquals(PlanPeriod.YEARLY, PaywallPlans.periodOf("YEAR"))
        assertEquals(PlanPeriod.MONTHLY, PaywallPlans.periodOf("MONTH"))
        assertEquals(PlanPeriod.WEEKLY, PaywallPlans.periodOf("WEEK"))
    }

    @Test fun noBillingPeriodMeansOneTimePurchase_andUnknownUnitsAreNotOffered() {
        assertEquals(PlanPeriod.LIFETIME, PaywallPlans.periodOf(null, hasPeriod = false))
        assertNull(PaywallPlans.periodOf("DAY", hasPeriod = true))
        assertNull(PaywallPlans.periodOf("UNKNOWN", hasPeriod = true))
    }

    @Test fun trialLengthIsInDays() {
        assertEquals(7, PaywallPlans.trialDays("DAY", 7))
        assertEquals(14, PaywallPlans.trialDays("WEEK", 2))
        assertEquals(30, PaywallPlans.trialDays("MONTH", 1))
        assertNull(PaywallPlans.trialDays("YEAR", 1))
        assertNull(PaywallPlans.trialDays("DAY", 0))
        assertNull(PaywallPlans.trialDays(null, 3))
    }

    @Test fun plansAreShownYearlyFirstThenMonthlyWeeklyLifetime() {
        val shuffled = listOf(plan("l", PlanPeriod.LIFETIME), plan("w", PlanPeriod.WEEKLY), plan("y", PlanPeriod.YEARLY), plan("m", PlanPeriod.MONTHLY))
        assertEquals(listOf("y", "m", "w", "l"), PaywallPlans.ordered(shuffled).map { it.productId })
    }

    @Test fun yearlyIsSelectedWhenThereIsOne_otherwiseTheFirst_andNothingWhenEmpty() {
        assertEquals("y", PaywallPlans.defaultSelection(listOf(plan("m", PlanPeriod.MONTHLY), plan("y", PlanPeriod.YEARLY))))
        assertEquals("m", PaywallPlans.defaultSelection(listOf(plan("m", PlanPeriod.MONTHLY), plan("w", PlanPeriod.WEEKLY))))
        assertNull(PaywallPlans.defaultSelection(emptyList()))
    }

    @Test fun bestValueBadgeNeedsYearlyAndAShorterPlanToCompareWith() {
        val y = plan("y", PlanPeriod.YEARLY); val m = plan("m", PlanPeriod.MONTHLY); val w = plan("w", PlanPeriod.WEEKLY); val l = plan("l", PlanPeriod.LIFETIME)
        assertTrue(PaywallPlans.showsBestValue(listOf(y, m), y))
        assertTrue(PaywallPlans.showsBestValue(listOf(y, w), y))
        assertFalse(PaywallPlans.showsBestValue(listOf(y), y))
        assertFalse(PaywallPlans.showsBestValue(listOf(y, l), y))
        assertFalse(PaywallPlans.showsBestValue(listOf(y, m), m))
    }
}
