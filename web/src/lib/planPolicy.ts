// When a build needs the "here is the plan, press Build" step before it starts.
//
// The plan step is one extra model call and one extra click. For a short, clear prompt it adds a wait and no information, so
// those go straight to the build. A long prompt, or one with a reference image, still shows the plan first so the person can
// check that it was understood before a minute-long build.

export const SHORT_PROMPT_MAX_CHARS = 160;

export function shouldAskForPlan(prompt: string, hasReferenceImage: boolean): boolean {
  if (hasReferenceImage) return true;
  return prompt.trim().length > SHORT_PROMPT_MAX_CHARS;
}
