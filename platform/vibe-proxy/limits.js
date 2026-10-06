// Per-IP and per-app rate limits, daily call and spend caps, and a per-app kill switch.
// Storage is injected: memoryStore here, Postgres in the edge function. The limiter fails closed.

/** In-memory store with expiry. Same interface the production store must implement. */
export function memoryStore({ now = () => Date.now() } = {}) {
    const m = new Map();
    const live = (k) => { const e = m.get(k); if (!e) return null; if (e.exp && e.exp <= now()) { m.delete(k); return null; } return e; };
    return {
        async incr(key, ttlSec) { const e = live(key); const n = (e?.n || 0) + 1; m.set(key, { n, exp: e?.exp || now() + ttlSec * 1000 }); return n; },
        async get(key) { return live(key)?.n || 0; },
        async set(key, n, ttlSec) { m.set(key, { n, exp: ttlSec ? now() + ttlSec * 1000 : 0 }); },
        async add(key, amount, ttlSec) { const e = live(key); const n = (e?.n || 0) + amount; m.set(key, { n, exp: e?.exp || now() + ttlSec * 1000 }); return n; },
    };
}

const DAY_TTL = 26 * 3600;

export function createLimiter({ store, now = () => Date.now(), perIpPerMin = 30, perAppPerMin = 120, dailyCalls = 5000, dailySpendMicros = 2_000_000, limitsFor }) {
    const deny = (reason, retryAfterSec) => ({ ok: false, reason, retryAfterSec });
    const minute = () => Math.floor(now() / 60_000);
    const day = () => new Date(now()).toISOString().slice(0, 10);
    const untilNextMinute = () => 60 - (Math.floor(now() / 1000) % 60);
    const untilNextDay = () => Math.ceil((Date.parse(day() + 'T00:00:00Z') + 86_400_000 - now()) / 1000);

    return {
        async check({ appId, ip }) {
            if (!appId || !ip) return deny('bad_request', 0);
            try {
                // optional per-app overrides (platform.app_limits); the resolver falls back to the defaults, so the caps stay on if it fails
                const o = limitsFor ? await limitsFor(appId) : null;
                const callCap = Number.isInteger(o?.dailyCalls) ? o.dailyCalls : dailyCalls;
                const spendCap = Number.isInteger(o?.dailySpendMicros) ? o.dailySpendMicros : dailySpendMicros;
                if (await store.get(`kill:${appId}`)) return deny('app_disabled', 0);
                if ((await store.incr(`ip:${appId}:${ip}:${minute()}`, 120)) > perIpPerMin) return deny('rate_limited_ip', untilNextMinute());
                if ((await store.incr(`app:${appId}:${minute()}`, 120)) > perAppPerMin) return deny('rate_limited_app', untilNextMinute());
                if ((await store.incr(`calls:${appId}:${day()}`, DAY_TTL)) > callCap) return deny('daily_call_cap', untilNextDay());
                if ((await store.get(`spend:${appId}:${day()}`)) >= spendCap) return deny('spend_cap', untilNextDay());
                return { ok: true };
            } catch {
                return deny('limiter_unavailable', 30);
            }
        },
        async recordSpend({ appId, micros }) {
            try { return await store.add(`spend:${appId}:${day()}`, micros, DAY_TTL); } catch { return null; }
        },
    };
}
