// Pure helpers for scripts/send-promo.ts: signed one-click unsubscribe on every promo email, and the recipient filter.
// Kept free of Supabase/Resend so it can be tested offline (test/promo-mail.test.ts).
// ./unsubscribe.mjs is a verbatim copy of harness/lib/unsubscribe/unsubscribe.mjs from the ops repo. Do not edit it here.
import { resendHeaders, footerHtml, isSuppressed } from './unsubscribe.mjs';

export const LIST = 'vb';
export const APP_NAME = 'VibeBuild';

/** Insert the unsubscribe footer just before </body> (or append when there is none). */
export function injectFooter(html, footer) {
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? html + footer : html.slice(0, i) + footer + html.slice(i);
}

/** The Resend payload for one promo email: footer in the HTML, List-Unsubscribe + List-Unsubscribe-Post headers. */
export function buildPromoMessage({ from, to, subject, html }) {
  return {
    from,
    to,
    subject,
    html: injectFooter(html, footerHtml(APP_NAME, to, LIST)),
    headers: resendHeaders(to, LIST),
  };
}

/**
 * Drop suppressed addresses (outreach_suppressions) and Apple private-relay addresses (Android only: never email
 * iOS/Apple/relay users). Returns the allowed users and counts only.
 */
export function filterRecipients(users, suppressed) {
  const counts = { candidates: users.length, suppressed: 0, relay: 0, no_email: 0 };
  const allowed = [];
  for (const u of users) {
    const email = String(u.email || '').trim().toLowerCase();
    if (!email) { counts.no_email++; continue; }
    if (/privaterelay\.appleid\.com$/.test(email)) { counts.relay++; continue; }
    if (isSuppressed(suppressed, email)) { counts.suppressed++; continue; }
    allowed.push(u);
  }
  return { allowed, counts };
}
