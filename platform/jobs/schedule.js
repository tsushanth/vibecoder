// Pure schedule arithmetic for declarative jobs. All times are epoch milliseconds, UTC only.
export const EVERY_MS = { '15m': 15 * 60_000, '1h': 3_600_000, '6h': 6 * 3_600_000, '1d': 86_400_000 };
const DAY = 86_400_000;
const BACKOFF_BASE = 5 * 60_000;
const BACKOFF_MAX = 6 * 3_600_000;

export const dayStartMs = (ms) => Math.floor(ms / DAY) * DAY;

/** The next time a job on `schedule` is due after `fromMs`. */
export function nextRunAt(schedule, fromMs) {
    if (schedule.every) return fromMs + EVERY_MS[schedule.every];
    const [h, m] = schedule.dailyAt.split(':').map(Number);
    const t = dayStartMs(fromMs) + (h * 60 + m) * 60_000;
    return t > fromMs ? t : t + DAY;
}

/** Delay before retrying after the nth consecutive failure (n >= 1). */
export const backoffMs = (failures) => Math.min(BACKOFF_BASE * 2 ** Math.min(failures - 1, 20), BACKOFF_MAX);
