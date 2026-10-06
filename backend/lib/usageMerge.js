// Shapes the platform proxy's per-app usage reports into one project-level answer. Numbers only: anything that is not a finite
// number, a YYYY-MM-DD day or a short snake_case kind/limit name is dropped, so a surprise in the proxy's reply can never reach the browser.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[A-Za-z_]{1,32}$/;
const METRICS = ['calls', 'errors', 'bytes', 'rows', 'ms', 'spendMicros'];
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
const numOrNull = (v) => (Number.isFinite(v) && v >= 0 ? v : null);

function cleanKinds(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [kind, m] of Object.entries(obj)) {
        if (!NAME.test(kind) || !m || typeof m !== 'object') continue;
        out[kind] = Object.fromEntries(METRICS.map((k) => [k, num(m[k])]));
    }
    return out;
}
function cleanNumbers(obj, nullable) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [k, v] of Object.entries(obj)) if (NAME.test(k)) out[k] = nullable ? numOrNull(v) : num(v);
    return out;
}
function addKinds(into, from) {
    for (const [kind, m] of Object.entries(from)) { const t = (into[kind] ||= Object.fromEntries(METRICS.map((k) => [k, 0]))); for (const k of METRICS) t[k] += m[k]; }
}

/** Returns a clean copy of one proxy report. */
export function cleanReport(r) {
    return {
        days: (Array.isArray(r?.days) ? r.days : []).filter((d) => typeof d?.day === 'string' && DAY.test(d.day)).map((d) => ({ day: d.day, byKind: cleanKinds(d.byKind) })),
        totals: cleanKinds(r?.totals), limits: cleanNumbers(r?.limits, false), usage: cleanNumbers(r?.usage, true),
    };
}

/**
 * Merges the reports of a project's apps (preview first, published last). Days and totals are summed across apps. `limits` and
 * `usage` come from the last app (the one visitors reach: the published app, else the preview), because caps apply per app and
 * adding them together would hide one app sitting at its cap. `apps` is how many apps were merged.
 */
export function mergeUsageReports(reports) {
    const cleaned = reports.map(cleanReport);
    if (!cleaned.length) return { days: [], totals: {}, limits: {}, usage: {}, apps: 0 };
    const byDay = new Map(); const totals = {};
    for (const r of cleaned) {
        for (const d of r.days) { const cell = byDay.get(d.day) || {}; addKinds(cell, d.byKind); byDay.set(d.day, cell); }
        addKinds(totals, r.totals);
    }
    const primary = cleaned.at(-1);
    return { days: [...byDay].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, byKind]) => ({ day, byKind })), totals, limits: primary.limits, usage: primary.usage, apps: cleaned.length };
}
