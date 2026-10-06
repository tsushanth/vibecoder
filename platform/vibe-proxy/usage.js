// Per-app usage metering and limits for every platform feature. Events carry counts, bytes, milliseconds and a status only:
// never request bodies, row contents, email addresses, tokens or secrets. Storage is injected (a Postgres daily rollup in
// production), and a metering failure must never break a request.

export const KINDS = ['api', 'ai', 'db', 'storage_upload', 'storage_download', 'storage_other', 'auth_email', 'auth_signin', 'auth_session', 'notify', 'job', 'pay_checkout', 'pay_orders', 'pay_webhook'];
const KIND_BY_ROUTE = {
    api: 'api', ai: 'ai', db: 'db',
    'storage/upload': 'storage_upload', 'storage/url': 'storage_download', 'storage/list': 'storage_other', 'storage/delete': 'storage_other',
    'auth/request': 'auth_email', 'auth/consume': 'auth_signin', 'auth/me': 'auth_session', 'auth/signout': 'auth_session',
    'notify/me': 'notify', 'pay/checkout': 'pay_checkout', 'pay/orders': 'pay_orders', 'pay/webhook': 'pay_webhook',
};
export const kindForRoute = (route) => (Object.hasOwn(KIND_BY_ROUTE, route) ? KIND_BY_ROUTE[route] : null);

const APP_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const num = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/**
 * Records usage. flushMs = 0 writes every event straight to the sink; flushMs > 0 merges events per (app, day, kind) in memory
 * and writes them together on a timer, so a busy app does not hammer one row. Metering never throws.
 */
export function createUsage({ sink, now = () => Date.now(), flushMs = 0 }) {
    let buf = new Map();
    let timer = null;
    const merge = (into, e) => { for (const k of ['calls', 'errors', 'bytes', 'rows', 'ms', 'spendMicros']) into[k] += e[k]; return into; };

    async function flush() {
        if (!buf.size) return;
        const batch = buf; buf = new Map();
        for (const e of batch.values()) {
            try { await sink(e); } catch { const k = `${e.appId}|${e.day}|${e.kind}`; const cur = buf.get(k); buf.set(k, cur ? merge(cur, e) : e); } // keep it for the next flush
        }
    }

    if (flushMs > 0) { timer = setInterval(() => { flush().catch(() => {}); }, flushMs); timer.unref?.(); }

    return {
        async record({ appId, kind, status, ok, rows = 0, bytes = 0, ms = 0, spendMicros = 0 }) {
            if (!KINDS.includes(kind) || !APP_ID.test(String(appId))) return;
            const failed = ok === false || (Number.isFinite(status) && status >= 400);
            const e = { appId, day: new Date(now()).toISOString().slice(0, 10), kind, calls: 1, errors: failed ? 1 : 0, bytes: num(bytes), rows: num(rows), ms: num(ms), spendMicros: num(spendMicros) };
            if (flushMs > 0) { const k = `${appId}|${e.day}|${kind}`; const cur = buf.get(k); buf.set(k, cur ? merge(cur, e) : e); return; }
            try { await sink(e); } catch { /* metering must never break a request */ }
        },
        flush,
        async close() { if (timer) clearInterval(timer); timer = null; await flush(); },
    };
}

// Caps a creator's app lives under. Defaults come from here and the proxy config; the admin API can override each per app.
export const LIMIT_DEFS = {
    rowCap:          { default: 20_000,      min: 100, max: 5_000_000,     label: 'rows across all tables' },
    dailyCalls:      { default: 5_000,       min: 10,  max: 100_000_000,   label: 'calls per day' },
    dailySpendMicros: { default: 50_000,     min: 0,   max: 1_000_000_000, label: 'AI spend per day, in millionths of a dollar' },
    storageBytes:    { default: 200 * 1024 * 1024, min: 0, max: 100 * 1024 ** 3, label: 'stored bytes' },
    storageFiles:    { default: 2_000,       min: 0,   max: 10_000_000,    label: 'stored files' },
    emailsPerDay:    { default: 200,         min: 0,   max: 1_000_000,     label: 'emails per day' },
    jobRunsPerDay:   { default: 300,         min: 0,   max: 100_000,       label: 'job runs per day' },
};
export const defaultLimits = () => Object.fromEntries(Object.entries(LIMIT_DEFS).map(([k, d]) => [k, d.default]));

/** Validates an admin-supplied override object. It replaces the whole set: {} clears every override. */
export function validateOverrides(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['overrides must be an object'] };
    const errors = []; const overrides = {};
    for (const k of Object.keys(input)) {
        const d = Object.hasOwn(LIMIT_DEFS, k) ? LIMIT_DEFS[k] : null;
        if (!d) { errors.push(`unknown limit ${k.slice(0, 40)}`); continue; }
        const v = input[k];
        if (!Number.isInteger(v) || v < d.min || v > d.max) { errors.push(`${k} must be an integer from ${d.min} to ${d.max}`); continue; }
        overrides[k] = v;
    }
    return errors.length ? { ok: false, errors: errors.slice(0, 10) } : { ok: true, overrides };
}

/** Defaults with valid stored overrides on top. Junk in storage is ignored rather than trusted. */
export function resolveLimits(defaults, overrides) {
    const out = { ...defaults };
    if (overrides && typeof overrides === 'object') for (const k of Object.keys(defaults)) if (Object.hasOwn(overrides, k) && Number.isInteger(overrides[k]) && overrides[k] >= 0) out[k] = overrides[k];
    return out;
}

/** Per-app effective limits with a short cache. If the store fails the defaults apply (the caps stay on). */
export function createLimitsResolver({ defaults = defaultLimits(), load, now = () => Date.now(), ttlMs = 30_000 }) {
    const cache = new Map();
    return {
        async limitsFor(appId) {
            const hit = cache.get(appId);
            if (hit && hit.exp > now()) return hit.value;
            let value;
            try { value = resolveLimits(defaults, await load(appId)); } catch { return { ...defaults }; }
            cache.set(appId, { value, exp: now() + ttlMs });
            if (cache.size > 5000) cache.delete(cache.keys().next().value);
            return value;
        },
        invalidate(appId) { cache.delete(appId); },
    };
}

export const emailsFrom = (byKind) => ['auth_email', 'notify'].reduce((n, k) => n + Math.max(0, (byKind[k]?.calls || 0) - (byKind[k]?.errors || 0)), 0);

const zero = () => ({ calls: 0, errors: 0, bytes: 0, rows: 0, ms: 0, spendMicros: 0 });
const addDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Shapes rollup rows into { days, totals, limits, usage }. Numbers only; days are contiguous, oldest first, ending today. */
export function buildUsageReport({ days, today, rows, limits, usage }) {
    const list = Array.from({ length: days }, (_, i) => addDay(today, i - days + 1));
    const byDay = new Map(list.map((d) => [d, {}]));
    const totals = {};
    for (const r of rows) {
        const day = byDay.get(r.day); if (!day) continue;
        const cell = (day[r.kind] ||= zero()); const tot = (totals[r.kind] ||= zero());
        for (const k of Object.keys(zero())) { cell[k] += Number(r[k]) || 0; tot[k] += Number(r[k]) || 0; }
    }
    return { days: list.map((day) => ({ day, byKind: byDay.get(day) })), totals, limits, usage };
}
