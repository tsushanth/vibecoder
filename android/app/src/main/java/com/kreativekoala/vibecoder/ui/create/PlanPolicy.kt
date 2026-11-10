package com.kreativekoala.vibecoder.ui.create

/**
 * When a build needs the "here is the plan, press Build" step first. A short, clear prompt goes straight to the build (the plan
 * step is one more model call and one more tap); a long prompt, or one with a reference image, still shows the plan.
 * Same rule and same limit as the web app (web/src/lib/planPolicy.ts).
 */
object PlanPolicy {
    const val SHORT_PROMPT_MAX_CHARS = 160

    fun shouldAskForPlan(prompt: String, hasReferenceImage: Boolean): Boolean {
        if (hasReferenceImage) return true
        return prompt.trim().length > SHORT_PROMPT_MAX_CHARS
    }
}
