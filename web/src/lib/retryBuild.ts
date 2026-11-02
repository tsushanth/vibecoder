/** Helpers for the "Try again" action on a failed app in the Apps list. */

export interface RetryableProject {
  id: string;
  status?: string | null;
  initial_prompt?: string | null;
}

/** POST /api/projects/{id}/retry only accepts a failed project that still has its prompt, so only offer it for those. */
export function canRetry(p: RetryableProject): boolean {
  return p.status === 'failed' && typeof p.initial_prompt === 'string' && p.initial_prompt.trim() !== '';
}

/** A copy of the list with one app's status changed (used to flip a retried app to "building" straight away). */
export function withStatus<T extends { id: string; status?: string | null }>(list: T[], id: string, status: string): T[] {
  return list.map((p) => (p.id === id ? { ...p, status } : p));
}

export type RetryErrorKey = 'notFailed' | 'noPrompt' | 'failed';

/** Which message to show when the retry request is refused. `notFailed` means it is already running or finished. */
export function retryErrorKey(status: number | undefined, message: string | undefined): RetryErrorKey {
  if (status === 400 && message && /not in failed state/i.test(message)) return 'notFailed';
  if (status === 400 && message && /no prompt/i.test(message)) return 'noPrompt';
  return 'failed';
}
