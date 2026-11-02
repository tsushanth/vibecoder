/** GET /api/status reports `{ operational, message, activeBuildCount }`; the banner shows only when operational is false. */

export const STATUS_POLL_MS = 60_000;
const MAX_MESSAGE_LENGTH = 300;

export interface SystemStatus {
  down: boolean;
  message: string | null;
}

export function parseSystemStatus(raw: unknown): SystemStatus {
  if (!raw || typeof raw !== 'object') return { down: false, message: null };
  const r = raw as Record<string, unknown>;
  if (r.operational !== false) return { down: false, message: null };
  const message = typeof r.message === 'string' ? r.message.trim().slice(0, MAX_MESSAGE_LENGTH) : '';
  return { down: true, message: message || null };
}
