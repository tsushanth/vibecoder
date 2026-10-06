// Pure helpers for the publish dialog's schema and jobs handling: the statuses a deploy answers with, the destructive-change list
// that needs the creator's confirmation, and the typed confirmation. Only table and column NAMES are ever handled; no row data.

export type Tone = 'success' | 'neutral' | 'warning' | 'error';
export type DestructiveKind = 'drop_table' | 'drop_column' | 'change_type' | 'make_required';
export interface DestructiveItem { kind: DestructiveKind; table: string; column?: string }
export interface StatusInfo { key: string; tone: Tone }
export interface DeployOutcome { schema: StatusInfo | null; jobs: StatusInfo | null; needsConfirmation: boolean; destructive: DestructiveItem[] }

export const SCHEMA_STATUS_KEYS = {
  applied: 'publish.schema.applied',
  unchanged: 'publish.schema.unchanged',
  invalid: 'publish.schema.invalid',
  needs_confirmation: 'publish.schema.needsConfirmation',
  failed: 'publish.schema.failed',
} as const;
const SCHEMA_TONES: Record<keyof typeof SCHEMA_STATUS_KEYS, Tone> = { applied: 'success', unchanged: 'neutral', invalid: 'error', needs_confirmation: 'warning', failed: 'error' };

export const JOBS_STATUS_KEYS = { applied: 'publish.jobs.applied', invalid: 'publish.jobs.invalid', failed: 'publish.jobs.failed' } as const;
const JOBS_TONES: Record<keyof typeof JOBS_STATUS_KEYS, Tone> = { applied: 'success', invalid: 'error', failed: 'error' };

export const DESTRUCTIVE_KIND_KEYS: Record<DestructiveKind, string> = {
  drop_table: 'publish.schema.kind.drop_table',
  drop_column: 'publish.schema.kind.drop_column',
  change_type: 'publish.schema.kind.change_type',
  make_required: 'publish.schema.kind.make_required',
};

const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const MAX_ITEMS = 100;
const own = <T extends object>(o: T, k: unknown): k is keyof T & string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

/** Keeps only well-formed {kind, table, column?} entries (names only), dropping anything else the server might send. */
export function parseDestructive(raw: unknown): DestructiveItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DestructiveItem[] = [];
  for (const d of raw) {
    if (out.length >= MAX_ITEMS) break;
    if (!d || typeof d !== 'object') continue;
    const { kind, table, column } = d as Record<string, unknown>;
    if (!own(DESTRUCTIVE_KIND_KEYS, kind) || typeof table !== 'string' || !IDENT.test(table)) continue;
    if (kind === 'drop_table') { out.push({ kind, table }); continue; }
    if (typeof column !== 'string' || !IDENT.test(column)) continue;
    out.push({ kind: kind as DestructiveKind, table, column });
  }
  return out;
}

export function schemaStatusInfo(status: unknown): StatusInfo | null {
  return own(SCHEMA_STATUS_KEYS, status) ? { key: SCHEMA_STATUS_KEYS[status], tone: SCHEMA_TONES[status] } : null;
}

export function jobsStatusInfo(status: unknown): StatusInfo | null {
  return own(JOBS_STATUS_KEYS, status) ? { key: JOBS_STATUS_KEYS[status], tone: JOBS_TONES[status] } : null;
}

/** Translation key and values for one line of the "what would be lost" list. */
export function describeDestructive(item: DestructiveItem): { key: string; values: { table: string; column: string } } {
  return { key: DESTRUCTIVE_KIND_KEYS[item.kind], values: { table: item.table, column: item.column ?? '' } };
}

/** What the creator may type to confirm: the word DELETE, or the name of any affected table. */
export function confirmPhrases(items: DestructiveItem[]): string[] {
  return ['DELETE', ...new Set(items.map((i) => i.table))];
}

export function isConfirmationTyped(input: string, items: DestructiveItem[]): boolean {
  if (!items.length) return false;
  const typed = String(input).trim();
  return typed !== '' && confirmPhrases(items).includes(typed);
}

export function deployOutcome(result: unknown): DeployOutcome {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const needsConfirmation = r.schemaStatus === 'needs_confirmation';
  return { schema: schemaStatusInfo(r.schemaStatus), jobs: jobsStatusInfo(r.jobsStatus), needsConfirmation, destructive: needsConfirmation ? parseDestructive(r.destructive) : [] };
}

export function deployBody(userId: string, subdomain: string, allowDestructiveSchema = false): { userId: string; subdomain: string; allowDestructiveSchema?: true } {
  return allowDestructiveSchema === true ? { userId, subdomain, allowDestructiveSchema: true } : { userId, subdomain };
}

/** The destructive changes in a dry-run answer from GET /api/projects/:id/schema/plan; empty unless it is an ok plan for an existing app. */
export function planDestructive(plan: unknown): DestructiveItem[] {
  const p = (plan && typeof plan === 'object' ? plan : {}) as Record<string, unknown>;
  return p.hasSchema === true && p.existing === true && p.status === 'ok' ? parseDestructive(p.destructive) : [];
}
