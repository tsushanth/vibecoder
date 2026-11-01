// First-touch signup attribution, captured in the browser. First-party only: one localStorage entry on this site, no
// third-party trackers and no personal data. It holds the utm_* tags, the host of the external referrer and the path of the
// first page visited, and is sent to the backend with the signup (POST /api/auth/register, field `signup_source`).
// The backend validates and length-limits everything again; nothing here is trusted for authorization.

export const SOURCE_KEY = 'vb_first_touch';
export const SOURCE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX = 64;

export interface SignupSource {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  referrer_host?: string;
  landing_path?: string;
}

interface Stored { t: number; s: SignupSource }

type KV = Pick<Storage, 'getItem' | 'setItem'>;

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

function tidy(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  // a value that looks like an email address is never stored
  if (!t || t.includes('@')) return undefined;
  return t.slice(0, MAX);
}

/** The host of an external referrer, or undefined for no referrer, an unparseable one, or a visit from our own site. */
export function externalReferrerHost(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    const own = ownHost.toLowerCase().replace(/^www\./, '').split(':')[0];
    if (!host || host === own) return undefined;
    return host.slice(0, MAX);
  } catch {
    return undefined;
  }
}

/** Build the first-touch record from a page load. Pure: everything it needs is passed in. */
export function buildFirstTouch(input: { search: string; referrer: string; pathname: string; ownHost: string }): SignupSource {
  const params = new URLSearchParams(input.search);
  const out: SignupSource = {};
  for (const k of UTM_KEYS) {
    const v = tidy(params.get(k));
    if (v) out[k] = v;
  }
  const host = externalReferrerHost(input.referrer, input.ownHost);
  if (host) out.referrer_host = host;
  // path only: the query string can carry tokens or personal data
  const path = input.pathname.split(/[?#]/)[0];
  if (path.startsWith('/') && !path.startsWith('//')) out.landing_path = path.slice(0, MAX);
  return out;
}

/** The stored first touch, or null when there is none or it is older than 90 days or unreadable. */
export function readFirstTouch(store: KV, now = Date.now()): SignupSource | null {
  try {
    const raw = store.getItem(SOURCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || typeof parsed.t !== 'number' || typeof parsed.s !== 'object' || parsed.s === null) return null;
    if (now - parsed.t > SOURCE_TTL_MS || parsed.t > now + 60_000) return null;
    return parsed.s;
  } catch {
    return null;
  }
}

/** Store the first touch unless one is already stored (first touch wins). Returns what is stored afterwards. */
export function captureFirstTouch(
  store: KV,
  input: { search: string; referrer: string; pathname: string; ownHost: string },
  now = Date.now(),
): SignupSource | null {
  const existing = readFirstTouch(store, now);
  if (existing) return existing;
  const s = buildFirstTouch(input);
  try { store.setItem(SOURCE_KEY, JSON.stringify({ t: now, s } satisfies Stored)); } catch { /* storage blocked: no attribution */ }
  return s;
}

/** Browser entry point: capture on this page load if nothing is stored yet. Safe to call on every page; never throws. */
export function captureFirstTouchInBrowser(): SignupSource | null {
  try {
    if (typeof window === 'undefined') return null;
    return captureFirstTouch(window.localStorage, {
      search: window.location.search,
      referrer: document.referrer,
      pathname: window.location.pathname,
      ownHost: window.location.hostname,
    });
  } catch {
    return null;
  }
}

/** The value to send as `signup_source` at signup, or undefined when there is nothing worth sending. */
export function getSignupSource(): SignupSource | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    const s = readFirstTouch(window.localStorage);
    return s && Object.keys(s).length ? s : undefined;
  } catch {
    return undefined;
  }
}
