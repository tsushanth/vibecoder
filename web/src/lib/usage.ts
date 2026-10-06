// Usage panel: pure helpers and a small client for GET /api/projects/:id/usage. The server answers with numbers only (counts per
// feature per day, the caps and current usage); nothing here stores or logs anything, and error results carry only a translation key.

export const USAGE_DAYS = 7;

// ---- what the server sends, defensively parsed
export type KindStats = { calls: number; errors: number; bytes: number; rows: number; ms: number; spendMicros: number };
export type UsageDay = { day: string; byKind: Record<string, KindStats> };
export type UsageData = {
  days: UsageDay[];
  totals: Record<string, KindStats>;
  limits: Record<string, number>;
  /** A figure the server could not read right now is null (shown as unknown, never as zero). */
  usage: Record<string, number | null>;
  apps: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[A-Za-z_]{1,32}$/;
const STAT_KEYS: (keyof KindStats)[] = ['calls', 'errors', 'bytes', 'rows', 'ms', 'spendMicros'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

function parseKinds(v: unknown): Record<string, KindStats> {
  const out: Record<string, KindStats> = {};
  if (!isObj(v)) return out;
  for (const [k, m] of Object.entries(v)) {
    if (!NAME.test(k) || !isObj(m)) continue;
    out[k] = Object.fromEntries(STAT_KEYS.map((f) => [f, num(m[f])])) as KindStats;
  }
  return out;
}

export function parseUsageResponse(body: unknown): UsageData | null {
  if (!isObj(body)) return null;
  const days: UsageDay[] = [];
  for (const d of Array.isArray(body.days) ? body.days : []) if (isObj(d) && typeof d.day === 'string' && DAY.test(d.day)) days.push({ day: d.day, byKind: parseKinds(d.byKind) });
  const limits: Record<string, number> = {};
  if (isObj(body.limits)) for (const [k, v] of Object.entries(body.limits)) if (NAME.test(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) limits[k] = v;
  const usage: Record<string, number | null> = {};
  if (isObj(body.usage)) for (const [k, v] of Object.entries(body.usage)) if (NAME.test(k)) usage[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  return { days, totals: parseKinds(body.totals), limits, usage, apps: num(body.apps) };
}

// ---- last-days activity per feature
export const FEATURES = [
  { key: 'data', kinds: ['db'] },
  { key: 'files', kinds: ['storage_upload', 'storage_download', 'storage_other'] },
  { key: 'accounts', kinds: ['auth_email', 'auth_signin', 'auth_session', 'notify'] },
  { key: 'jobs', kinds: ['job'] },
  { key: 'payments', kinds: ['pay_checkout', 'pay_orders', 'pay_webhook'] },
  { key: 'connectors', kinds: ['api', 'ai'] },
] as const;
export type FeatureKey = (typeof FEATURES)[number]['key'];

export type FeatureSeries = { key: FeatureKey; total: number; errors: number; perDay: number[]; days: string[]; max: number };

/** One series per feature that saw any activity, in a fixed order. perDay lines up with `days`. */
export function featureSeries(data: UsageData): FeatureSeries[] {
  const days = data.days.map((d) => d.day);
  const out: FeatureSeries[] = [];
  for (const f of FEATURES) {
    const perDay = data.days.map((d) => f.kinds.reduce((n, k) => n + (d.byKind[k]?.calls ?? 0), 0));
    const total = perDay.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const errors = data.days.reduce((n, d) => n + f.kinds.reduce((m, k) => m + (d.byKind[k]?.errors ?? 0), 0), 0);
    out.push({ key: f.key, total, errors, perDay, days, max: Math.max(...perDay) });
  }
  return out;
}

/** Bar height as a percentage of the busiest day: a day with any activity is never drawn as nothing. */
export function barPercent(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.max(6, Math.min(100, Math.round((value / max) * 100)));
}

// ---- usage against the caps
export const METERS = [
  { key: 'rows', usage: 'rows', limit: 'rowCap', unit: 'count' },
  { key: 'storage', usage: 'storageBytes', limit: 'storageBytes', unit: 'bytes' },
  { key: 'files', usage: 'files', limit: 'storageFiles', unit: 'count' },
  { key: 'calls', usage: 'callsToday', limit: 'dailyCalls', unit: 'count' },
  { key: 'ai', usage: 'spendMicrosToday', limit: 'dailySpendMicros', unit: 'money' },
  { key: 'emails', usage: 'emailsToday', limit: 'emailsPerDay', unit: 'count' },
  { key: 'jobs', usage: 'jobRunsToday', limit: 'jobRunsPerDay', unit: 'count' },
] as const;
export type MeterKey = (typeof METERS)[number]['key'];
export type MeterState = 'ok' | 'warn' | 'full' | 'unknown';
export type Meter = { key: MeterKey; unit: 'count' | 'bytes' | 'money'; used: number | null; cap: number; percent: number; state: MeterState };

export const WARN_AT = 0.8;

export function meterState(used: number | null, cap: number): MeterState {
  if (used === null || !Number.isFinite(used)) return 'unknown';
  if (cap <= 0) return 'full'; // a cap of 0 switches the feature off
  const ratio = used / cap;
  if (ratio >= 1) return 'full';
  return ratio >= WARN_AT ? 'warn' : 'ok';
}

/** Meters for every cap the server reported. Fill is capped at 100%; the state still says when usage is over. */
export function capMeters(data: UsageData): Meter[] {
  const out: Meter[] = [];
  for (const m of METERS) {
    const cap = data.limits[m.limit];
    if (cap === undefined || !(m.usage in data.usage)) continue;
    const used = data.usage[m.usage];
    const percent = used === null ? 0 : cap > 0 ? Math.min(100, Math.floor((used / cap) * 100)) : 100;
    out.push({ key: m.key, unit: m.unit, used, cap, percent, state: meterState(used, cap) });
  }
  return out;
}

export type Overall = { state: 'ok' | 'warn' | 'full'; full: MeterKey[]; warn: MeterKey[] };

export function overall(meters: Meter[]): Overall {
  const full = meters.filter((m) => m.state === 'full').map((m) => m.key);
  const warn = meters.filter((m) => m.state === 'warn').map((m) => m.key);
  return { state: full.length ? 'full' : warn.length ? 'warn' : 'ok', full, warn };
}

// ---- formatting (plain and locale-independent; the panel adds the units' words)
export function formatBytes(n: number): string {
  if (!(n > 0)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${i === 0 ? Math.round(v) : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

export function formatMoney(micros: number): string {
  if (!(micros > 0)) return '$0.00';
  if (micros < 10_000) return '<$0.01';
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatMeterValue(unit: Meter['unit'], v: number): string {
  return unit === 'bytes' ? formatBytes(v) : unit === 'money' ? formatMoney(v) : formatCount(v);
}

// ---- errors and the client
export const USAGE_ERROR_KEYS = ['usage.error.signIn', 'usage.error.forbidden', 'usage.error.unavailable', 'usage.error.rateLimited', 'usage.error.network', 'usage.error.unknown'] as const;
export type UsageErrorKey = (typeof USAGE_ERROR_KEYS)[number];

export function usageErrorKey(status: number): UsageErrorKey {
  switch (status) {
    case 0: return 'usage.error.network';
    case 401: return 'usage.error.signIn';
    case 403: return 'usage.error.forbidden';
    case 429: return 'usage.error.rateLimited';
    case 502: return 'usage.error.unavailable';
    default: return 'usage.error.unknown';
  }
}

export type UsageResult = { ok: true; data: UsageData } | { ok: false; status: number; errorKey: UsageErrorKey };

export interface UsageClient { get(projectId: string, days?: number): Promise<UsageResult> }

export function createUsageClient({ baseUrl, fetchImpl = fetch, withAuth }: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  withAuth: (headers: Record<string, string>) => Promise<Record<string, string>>;
}): UsageClient {
  const failure = (status: number): UsageResult => ({ ok: false, status, errorKey: usageErrorKey(status) });
  return {
    async get(projectId, days = USAGE_DAYS) {
      const d = Number.isInteger(days) && days >= 1 && days <= 30 ? days : USAGE_DAYS;
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/usage?days=${d}`, { method: 'GET', headers: await withAuth({}), cache: 'no-store', credentials: 'omit' });
      } catch { return failure(0); }
      if (!res.ok) return failure(res.status);
      const data = parseUsageResponse(await res.json().catch(() => null));
      return data ? { ok: true, data } : { ok: false, status: res.status, errorKey: 'usage.error.unknown' };
    },
  };
}
