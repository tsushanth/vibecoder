// The one-question prompt shown once after a person's first ready build: "What were you hoping to make today?".
// Fixed choices only (no free text), so nothing personal can be typed into it. The server decides eligibility and keeps the
// answer (GET/POST /api/events/first-build-survey); this file holds the choice list and the "already handled" flag the browser
// keeps so it does not even ask the server again. Storage can be blocked; every access is guarded.

export const SURVEY_STORAGE_KEY = 'vb_first_build_survey_done';

export const SURVEY_CHOICES = ['game_or_fun', 'personal_tool', 'work_or_business', 'learning', 'just_trying', 'something_else'] as const;
export type SurveyChoice = (typeof SURVEY_CHOICES)[number];
/** Sent when the person closes the prompt without answering, so the server never shows it again. */
export type SurveyAnswer = SurveyChoice | 'dismissed';

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function browserStore(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function surveyHandled(store: KV | null = browserStore()): boolean {
  try {
    return store?.getItem(SURVEY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSurveyHandled(store: KV | null = browserStore()): void {
  try {
    store?.setItem(SURVEY_STORAGE_KEY, '1');
  } catch {
    /* blocked or full: the server still refuses a second answer */
  }
}
