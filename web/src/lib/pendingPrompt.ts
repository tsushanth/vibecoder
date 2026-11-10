// A prompt typed on the landing page before the person has an account, carried through signup or login to the Create page.
//
// It is kept in sessionStorage (same tab, cleared with the tab) and mirrored to localStorage with a timestamp, so it also
// survives the cases sessionStorage does not: a sign-in link opened in another tab, an OAuth round trip that lands in a new
// tab, a browser that restarted in between. A stale copy (older than 24 hours) is ignored and removed. Storage can be
// blocked or full; every access is guarded and the page works without it (the person types the prompt again).

export const PENDING_PROMPT_KEY = 'vb_pending_prompt';
export const PENDING_PROMPT_TTL_MS = 24 * 60 * 60 * 1000;
export const PENDING_PROMPT_MAX = 2000; // same cap the build endpoint enforces

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Stores {
  session?: KV | null;
  local?: KV | null;
}

function browserStores(): Stores {
  const pick = (get: () => Storage): KV | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  return { session: pick(() => window.sessionStorage), local: pick(() => window.localStorage) };
}

/** Remember a prompt. An empty or blank prompt clears whatever was stored instead. */
export function savePendingPrompt(prompt: string, stores: Stores = browserStores(), now = Date.now()): void {
  const text = prompt.trim().slice(0, PENDING_PROMPT_MAX);
  if (!text) {
    clearPendingPrompt(stores);
    return;
  }
  try { stores.session?.setItem(PENDING_PROMPT_KEY, text); } catch { /* blocked or full */ }
  try { stores.local?.setItem(PENDING_PROMPT_KEY, JSON.stringify({ t: now, p: text })); } catch { /* blocked or full */ }
}

/** Read the stored prompt without removing it (null when there is none, it is blank, or it is older than 24 hours). */
export function peekPendingPrompt(stores: Stores = browserStores(), now = Date.now()): string | null {
  try {
    const s = stores.session?.getItem(PENDING_PROMPT_KEY);
    if (s && s.trim()) return s.trim().slice(0, PENDING_PROMPT_MAX);
  } catch { /* blocked */ }
  try {
    const raw = stores.local?.getItem(PENDING_PROMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: unknown; p?: unknown };
    if (typeof parsed.t !== 'number' || typeof parsed.p !== 'string') return null;
    if (now - parsed.t > PENDING_PROMPT_TTL_MS || parsed.t > now + 60_000) return null;
    const text = parsed.p.trim();
    return text ? text.slice(0, PENDING_PROMPT_MAX) : null;
  } catch {
    return null;
  }
}

export function clearPendingPrompt(stores: Stores = browserStores()): void {
  try { stores.session?.removeItem(PENDING_PROMPT_KEY); } catch { /* blocked */ }
  try { stores.local?.removeItem(PENDING_PROMPT_KEY); } catch { /* blocked */ }
}

/** The stored prompt, removed from both places so a build is started from it exactly once. */
export function takePendingPrompt(stores: Stores = browserStores(), now = Date.now()): string | null {
  const text = peekPendingPrompt(stores, now);
  clearPendingPrompt(stores);
  return text;
}
