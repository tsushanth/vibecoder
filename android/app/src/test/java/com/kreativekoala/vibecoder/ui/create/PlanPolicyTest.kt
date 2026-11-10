package com.kreativekoala.vibecoder.ui.create

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanPolicyTest {
    @Test
    fun shortPromptSkipsThePlan() {
        assertFalse(PlanPolicy.shouldAskForPlan("A pomodoro timer with a task list", false))
        assertFalse(PlanPolicy.shouldAskForPlan("a".repeat(PlanPolicy.SHORT_PROMPT_MAX_CHARS), false))
        assertFalse(PlanPolicy.shouldAskForPlan("  " + "a".repeat(PlanPolicy.SHORT_PROMPT_MAX_CHARS) + "  ", false))
    }

    @Test
    fun longPromptOrImageKeepsThePlan() {
        assertTrue(PlanPolicy.shouldAskForPlan("a".repeat(PlanPolicy.SHORT_PROMPT_MAX_CHARS + 1), false))
        assertTrue(PlanPolicy.shouldAskForPlan("short", true))
    }
}
