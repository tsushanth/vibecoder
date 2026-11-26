// Visit counts for the creator's own published apps (GET /api/visits). Pure helpers: parsing and the choice of link.
// `openUrl` is the app's address with a short-lived signature: opening it leaves this browser out of the count.

export type AppVisits = { url: string; openUrl: string; today: number; last7Days: number; total: number };
export type CreatorVisits = { countingSince: string | null; apps: Record<string, AppVisits> };

export const NO_VISITS: CreatorVisits = { countingSince: null, apps: {} };

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) ? v : null);

/** Anything the server did not send properly is left out: a missing number is never shown as zero. */
export function parseVisits(body: unknown): CreatorVisits {
  const b = (body && typeof body === 'object' ? body : {}) as { countingSince?: unknown; apps?: unknown };
  const apps: Record<string, AppVisits> = {};
  for (const item of Array.isArray(b.apps) ? b.apps : []) {
    const a = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const url = https(a.url), openUrl = https(a.openUrl);
    const today = count(a.today), last7Days = count(a.last7Days), total = count(a.total);
    if (typeof a.projectId !== 'string' || !url || !openUrl || today === null || last7Days === null || total === null) continue;
    apps[a.projectId] = { url, openUrl, today, last7Days, total };
  }
  const since = typeof b.countingSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.countingSince) ? b.countingSince : null;
  return { countingSince: since, apps };
}

/** The address to open for the creator: the signed one when it is for this same site, else the plain address. */
export function ownerHref(liveUrl: string, visits: AppVisits | undefined): string {
  if (!visits) return liveUrl;
  try {
    return new URL(visits.openUrl).hostname === new URL(liveUrl).hostname ? visits.openUrl : liveUrl;
  } catch {
    return liveUrl;
  }
}
