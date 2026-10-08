package com.kreativekoala.vibecoder.ui.paywall

enum class PlanPeriod { YEARLY, MONTHLY, WEEKLY, LIFETIME }

/** One purchasable plan, in the terms the paywall screen needs. [priceText] is the store's own formatted price. */
data class PaywallPlan(val productId: String, val period: PlanPeriod, val priceText: String, val trialDays: Int?)

/** Pure rules for turning store products into paywall plans (no RevenueCat types, so they are unit-testable). */
object PaywallPlans {
    /** The store reports a billing period as a unit name; no period at all means a one-time purchase. Unknown units are not offered. */
    fun periodOf(unitName: String?, hasPeriod: Boolean = unitName != null): PlanPeriod? = when {
        !hasPeriod -> PlanPeriod.LIFETIME
        unitName == "YEAR" -> PlanPeriod.YEARLY
        unitName == "MONTH" -> PlanPeriod.MONTHLY
        unitName == "WEEK" -> PlanPeriod.WEEKLY
        else -> null
    }

    fun trialDays(unitName: String?, value: Int): Int? = when (unitName) {
        "DAY" -> value
        "WEEK" -> value * 7
        "MONTH" -> value * 30
        else -> null
    }.takeIf { it != null && it > 0 }

    /** Yearly first, then monthly, weekly, lifetime. */
    fun ordered(plans: List<PaywallPlan>): List<PaywallPlan> = plans.sortedBy { it.period.ordinal }

    /** What is selected when the screen opens: the yearly plan if there is one, else the first. */
    fun defaultSelection(plans: List<PaywallPlan>): String? = (plans.firstOrNull { it.period == PlanPeriod.YEARLY } ?: plans.firstOrNull())?.productId

    /** The "best value" badge only means something when yearly can be compared with a shorter plan. */
    fun showsBestValue(plans: List<PaywallPlan>, plan: PaywallPlan): Boolean =
        plan.period == PlanPeriod.YEARLY && plans.any { it.period == PlanPeriod.MONTHLY || it.period == PlanPeriod.WEEKLY }
}
