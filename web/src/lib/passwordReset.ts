/** Pure helpers for the "Forgot password?" flow (AuthForm) and the /reset page. */

/** The sign-up form asks for at least this many characters; a new password must meet the same bar. */
export const MIN_PASSWORD_LENGTH = 6;

/** Where the emailed link sends the person. This exact URL must be in Supabase's Redirect URLs allow-list. */
export function recoveryRedirectUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/reset`;
}

export type PasswordProblem = 'tooShort' | 'mismatch';

/** Length first, then the confirmation. Passwords are compared exactly, never trimmed. */
export function validateNewPassword(password: string, confirm: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort';
  if (password !== confirm) return 'mismatch';
  return null;
}

/**
 * Supabase reports a dead link in the query string or the hash (`error`, `error_code`, `error_description`).
 * 'expired' is the usual case (links are single use and short lived); 'invalid' is any other error.
 */
export function resetLinkProblem(search: string, hash: string): 'expired' | 'invalid' | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  for (const [k, v] of new URLSearchParams(hash.replace(/^#/, ''))) if (!params.has(k)) params.set(k, v);
  if (params.get('error_code') === 'otp_expired') return 'expired';
  if (params.has('error') || params.has('error_code') || params.has('error_description')) return 'invalid';
  return null;
}
