// Sender-side helpers for the signed one-click unsubscribe (Worker: kreativekoala.llc/unsubscribe).
// Dependency-free (node:crypto + global fetch). Python twin: unsubscribe.py. Both must reproduce test/vectors.json.
//
// The secret comes from the environment variable UNSUB_SECRET on every call and has NO default: a missing or short
// secret throws, so a sender can never ship unsigned or weakly signed links.

import { createHmac } from 'node:crypto';

export const BASE_URL = 'https://kreativekoala.llc/unsubscribe';
export const OWNER_MAILTO = 'mailto:t.sushanth@gmail.com?subject=unsubscribe';
export const POSTAL_ADDRESS = 'Kreative Koala Solutions LLC, 5900 Balcones Dr, Ste 100, Austin TX 78731';
export const MIN_SECRET_LENGTH = 16;
// Keep in sync with LISTS in the Worker (kreative-koala-legal/src/unsubscribe.mjs). Unknown ids throw so a sender can
// never emit a link the Worker would reject.
export const KNOWN_LISTS = { mm: 'MeetingMind', sa: 'ScribeAI', rv: 'RiddleVerse', vb: 'VibeBuild' };

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]+$/;

export function normalizeEmail(email) {
  const e = String(email ?? '').trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) throw new Error('unsubscribe: invalid email address');
  return e;
}

function secretFromEnv(env = process.env) {
  const s = env.UNSUB_SECRET;
  if (!s || s.length < MIN_SECRET_LENGTH) throw new Error(`unsubscribe: UNSUB_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters`);
  return s;
}

function checkList(list) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_LISTS, list)) throw new Error(`unsubscribe: unknown list id "${list}"`);
  return list;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** base64url(HMAC-SHA256(secret, list + "|" + normalizedEmail)). `secret` defaults to env UNSUB_SECRET (never a literal). */
export function signature(email, list, secret = secretFromEnv()) {
  return b64url(createHmac('sha256', secret).update(`${checkList(list)}|${normalizeEmail(email)}`).digest());
}

export function unsubscribeUrl(email, list, { secret } = {}) {
  const e = normalizeEmail(email);
  const s = signature(e, list, secret ?? secretFromEnv());
  return `${BASE_URL}?e=${b64url(Buffer.from(e, 'utf8'))}&l=${list}&s=${s}`;
}

/** Headers for the Resend `headers` field (single send or each item of a batch). */
export function resendHeaders(email, list, opts) {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(email, list, opts)}>, <${OWNER_MAILTO}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Plain ASCII footer for text emails. Starts with a blank line so it can be appended directly. */
export function footerText(app, email, list, opts) {
  return [
    '',
    '--',
    `You are receiving this announcement because you have an account with ${app}.`,
    `Unsubscribe: ${unsubscribeUrl(email, list, opts)}`,
    'Or reply "unsubscribe" to this email.',
    'Service and account emails may still be sent.',
    POSTAL_ADDRESS,
    '',
  ].join('\n');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Same footer as HTML for html emails. */
export function footerHtml(app, email, list, opts) {
  const url = unsubscribeUrl(email, list, opts);
  return `<p style="color:#64748b;font-size:12px;line-height:1.5">You are receiving this announcement because you have an account with ${esc(app)}.<br>` +
    `<a href="${esc(url)}">Unsubscribe</a> or reply &quot;unsubscribe&quot; to this email.<br>` +
    `Service and account emails may still be sent.<br>${esc(POSTAL_ADDRESS)}</p>`;
}

// ---- Pre-send suppression check ---------------------------------------------------------------------------------
// Pattern: load the whole table ONCE per run into a Set, then drop every recipient found in it. Fail closed: if the
// table cannot be read, throw and send nothing.

/** Load all suppressed addresses (lowercased, trimmed) from public.outreach_suppressions via PostgREST. */
export async function loadSuppressions({ supabaseUrl, serviceKey, fetchImpl = fetch, pageSize = 1000 } = {}) {
  if (!supabaseUrl || !serviceKey) throw new Error('unsubscribe: supabaseUrl and serviceKey are required');
  const headers = { apikey: serviceKey };
  if (String(serviceKey).startsWith('eyJ')) headers.Authorization = `Bearer ${serviceKey}`;
  const out = new Set();
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetchImpl(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/outreach_suppressions?select=email&order=email.asc&limit=${pageSize}&offset=${offset}`, { headers });
    if (!res.ok) throw new Error(`unsubscribe: could not read outreach_suppressions (status ${res.status}); refusing to send`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('unsubscribe: unexpected suppression response; refusing to send');
    for (const r of rows) if (r && r.email) out.add(String(r.email).trim().toLowerCase());
    if (rows.length < pageSize) return out;
  }
}

export function isSuppressed(suppressedSet, email) {
  return suppressedSet.has(String(email ?? '').trim().toLowerCase());
}
