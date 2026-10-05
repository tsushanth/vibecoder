// Key entry for generated apps: pure helpers and a small client for GET/PUT/DELETE /api/projects/:id/secrets.
// The server never returns a key: it lists names and update times, plus the names the app's manifest asks for. Nothing here
// stores, logs or returns a pasted value; error results carry only a translation key.

export const MAX_SECRET_LENGTH = 4096;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

// ---- Stripe keys (apps that sell things; see payKeys.ts for the panel helpers)
export const STRIPE_SECRET_KEY = 'STRIPE_SECRET_KEY';
export const STRIPE_WEBHOOK_SECRET = 'STRIPE_WEBHOOK_SECRET';

export type StripeKeyErrorKey = 'secrets.error.stripePublishable' | 'secrets.error.stripeKeyFormat' | 'secrets.error.stripeWebhookFormat';

// Test keys cannot be told from live ones once stored (values are write-only), so the panel always tells the creator to start with test keys.
const SECRET_KEY = /^(sk|rk)_(test|live)_\S{8,}$/;
const PUBLISHABLE_KEY = /^pk_(test|live)_/;
const WEBHOOK_SECRET = /^whsec_\S{8,}$/;

/** Catches the common wrong pastes (publishable key, webhook secret in the key field and the reverse) before anything is sent. */
export function stripeKeyProblem(name: string, value: string): StripeKeyErrorKey | null {
  if (name === STRIPE_SECRET_KEY) {
    if (PUBLISHABLE_KEY.test(value)) return 'secrets.error.stripePublishable';
    return SECRET_KEY.test(value) ? null : 'secrets.error.stripeKeyFormat';
  }
  if (name === STRIPE_WEBHOOK_SECRET) return WEBHOOK_SECRET.test(value) ? null : 'secrets.error.stripeWebhookFormat';
  return null;
}

const WEBHOOK_PATH = /^\/[a-z0-9][a-z0-9-]{1,60}[a-z0-9]\/pay\/webhook$/;

/** The webhook URL is shown as text for the creator to paste into Stripe, so it must look exactly like what the proxy serves. */
export function safeWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !WEBHOOK_PATH.test(u.pathname)) return null;
  return u.href === raw ? raw : null;
}

const MAX_PURPOSE = 200;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const SECRET_ERROR_KEYS = [
  'secrets.error.signIn',
  'secrets.error.forbidden',
  'secrets.error.notFound',
  'secrets.error.unavailable',
  'secrets.error.notSetUp',
  'secrets.error.rateLimited',
  'secrets.error.invalid',
  'secrets.error.tooLong',
  'secrets.error.empty',
  'secrets.error.network',
  'secrets.error.unknown',
  'secrets.error.stripePublishable',
  'secrets.error.stripeKeyFormat',
  'secrets.error.stripeWebhookFormat',
] as const;
export type SecretErrorKey = (typeof SECRET_ERROR_KEYS)[number];

export function errorKeyForStatus(status: number): SecretErrorKey {
  switch (status) {
    case 0: return 'secrets.error.network';
    case 400: return 'secrets.error.invalid';
    case 401: return 'secrets.error.signIn';
    case 403: return 'secrets.error.forbidden';
    case 404: return 'secrets.error.notFound';
    case 413: return 'secrets.error.tooLong';
    case 429: return 'secrets.error.rateLimited';
    case 502: return 'secrets.error.unavailable';
    case 503: return 'secrets.error.notSetUp';
    default: return 'secrets.error.unknown';
  }
}

export type SecretStatus = { name: string; updatedAt: string | null };
export type RequiredSecret = { name: string; connectors: string[]; purpose?: string };
/** `pay` is present only for an app that sells things: where the creator registers the Stripe webhook (null until the app has a URL). */
export type SecretsData = { secrets: SecretStatus[]; required: RequiredSecret[]; pay?: { webhookUrl: string | null } };
export type SecretRow = { name: string; connectors: string[]; isSet: boolean; updatedAt: string | null; required: boolean; purpose?: string };

export function validateSecretInput(raw: string): { ok: true; value: string } | { ok: false; errorKey: SecretErrorKey } {
  if (typeof raw !== 'string') return { ok: false, errorKey: 'secrets.error.empty' };
  const value = raw.trim();
  if (!value) return { ok: false, errorKey: 'secrets.error.empty' };
  if (value.length > MAX_SECRET_LENGTH) return { ok: false, errorKey: 'secrets.error.tooLong' };
  if (CONTROL_CHARS.test(value)) return { ok: false, errorKey: 'secrets.error.invalid' };
  return { ok: true, value };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Defensive parse of the server's answer. Unknown fields (a value, if a server ever sent one) are never copied. */
export function parseSecretsResponse(body: unknown): SecretsData | null {
  if (!isObj(body)) return null;
  const secrets: SecretStatus[] = [];
  for (const s of Array.isArray(body.secrets) ? body.secrets : []) {
    if (!isObj(s) || typeof s.name !== 'string' || !SECRET_NAME.test(s.name)) continue;
    secrets.push({ name: s.name, updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null });
  }
  const byName = new Map<string, string[]>();
  const purposes = new Map<string, string>();
  for (const r of Array.isArray(body.required) ? body.required : []) {
    if (!isObj(r) || typeof r.name !== 'string' || !SECRET_NAME.test(r.name)) continue;
    const connectors = Array.isArray(r.connectors) ? r.connectors.filter((c): c is string => typeof c === 'string') : [];
    byName.set(r.name, [...new Set([...(byName.get(r.name) ?? []), ...connectors])]);
    if (typeof r.purpose === 'string' && r.purpose.trim() && r.purpose.length <= MAX_PURPOSE && !CONTROL_CHARS.test(r.purpose) && !purposes.has(r.name)) purposes.set(r.name, r.purpose.trim());
  }
  const out: SecretsData = { secrets, required: [...byName].map(([name, connectors]) => ({ name, connectors, ...(purposes.has(name) ? { purpose: purposes.get(name) } : {}) })) };
  if (isObj(body.pay)) out.pay = { webhookUrl: safeWebhookUrl(body.pay.webhookUrl) };
  return out;
}

/** Required secrets first, in the order the app declares them, then any other stored secret (so it can still be removed). */
export function buildSecretRows(required: RequiredSecret[], secrets: SecretStatus[]): SecretRow[] {
  const stored = new Map(secrets.map((s) => [s.name, s]));
  const rows: SecretRow[] = required.map((r) => ({ name: r.name, connectors: r.connectors, isSet: stored.has(r.name), updatedAt: stored.get(r.name)?.updatedAt ?? null, required: true, ...(r.purpose ? { purpose: r.purpose } : {}) }));
  const needed = new Set(required.map((r) => r.name));
  const extras = secrets.filter((s) => !needed.has(s.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const s of extras) rows.push({ name: s.name, connectors: [], isSet: true, updatedAt: s.updatedAt, required: false });
  return rows;
}

export function panelVisibility(rows: SecretRow[]): { show: boolean; missing: number; total: number } {
  const req = rows.filter((r) => r.required);
  return { show: rows.length > 0, missing: req.filter((r) => !r.isSet).length, total: req.length };
}

export type SecretsResult<T = undefined> = ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; status: number; errorKey: SecretErrorKey };

export interface SecretsClient {
  list(projectId: string): Promise<SecretsResult<SecretsData>>;
  set(projectId: string, name: string, value: string): Promise<SecretsResult>;
  remove(projectId: string, name: string): Promise<SecretsResult>;
}

export function createSecretsClient({ baseUrl, fetchImpl = fetch, withAuth }: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  withAuth: (headers: Record<string, string>) => Promise<Record<string, string>>;
}): SecretsClient {
  const root = (id: string) => `${baseUrl}/api/projects/${encodeURIComponent(id)}/secrets`;
  const bad = { ok: false as const, status: 400, errorKey: errorKeyForStatus(400) };

  async function send(url: string, init: RequestInit, headers: Record<string, string>): Promise<Response | null> {
    try {
      return await fetchImpl(url, { ...init, headers: await withAuth(headers), cache: 'no-store', credentials: 'omit' });
    } catch {
      return null; // never keep the error: its message could echo the request
    }
  }
  const failure = (status: number) => ({ ok: false as const, status, errorKey: errorKeyForStatus(status) });

  return {
    async list(projectId) {
      const res = await send(root(projectId), { method: 'GET' }, {});
      if (!res) return failure(0);
      if (!res.ok) return failure(res.status);
      const data = parseSecretsResponse(await res.json().catch(() => null));
      return data ? { ok: true, data } : { ok: false, status: res.status, errorKey: 'secrets.error.unknown' };
    },
    async set(projectId, name, value) {
      if (!SECRET_NAME.test(name)) return bad;
      const res = await send(`${root(projectId)}/${name}`, { method: 'PUT', body: JSON.stringify({ value }) }, { 'Content-Type': 'application/json' });
      if (!res) return failure(0);
      return res.ok ? { ok: true } : failure(res.status);
    },
    async remove(projectId, name) {
      if (!SECRET_NAME.test(name)) return bad;
      const res = await send(`${root(projectId)}/${name}`, { method: 'DELETE' }, {});
      if (!res) return failure(0);
      return res.ok ? { ok: true } : failure(res.status);
    },
  };
}

/**
 * Validates, trims and sends a pasted key. `sent` tells the caller whether a request was made: when true the input must be
 * cleared whatever the outcome (the key is not kept in the page); when false the user can correct what they typed.
 */
export async function submitSecret(client: SecretsClient, projectId: string, name: string, raw: string): Promise<{ ok: true; sent: true } | { ok: false; sent: boolean; errorKey: SecretErrorKey }> {
  const v = validateSecretInput(raw);
  if (!v.ok) return { ok: false, sent: false, errorKey: v.errorKey };
  const wrong = stripeKeyProblem(name, v.value); // a wrong paste is refused here, so it is kept in the field to correct
  if (wrong) return { ok: false, sent: false, errorKey: wrong };
  const r = await client.set(projectId, name, v.value);
  return r.ok ? { ok: true, sent: true } : { ok: false, sent: true, errorKey: r.errorKey };
}
