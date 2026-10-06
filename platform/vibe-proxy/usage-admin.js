// Admin handlers for GET /admin/apps/:app/usage?days=1..30 and GET|POST /admin/apps/:app/limits. Authentication and routing live in
// proxy-app/admin.js, which calls this after the bearer token has been checked. { appId, sub, method, query, readBody } in, { status, body } out.
// Everything returned is a number (or null when a figure cannot be read right now): no row contents, emails or secrets.
import { buildUsageReport, validateOverrides, emailsFrom } from './usage.js';

export const LIMITS_BODY_LIMIT = 2048;
const json = (status, body) => ({ status, body });

export function createUsageAdmin({ appStore, usageStore, limitsStore, limitsResolver, defaults, executor, storageStore, limiterStore, now = () => Date.now() }) {
    const today = () => new Date(now()).toISOString().slice(0, 10);
    const safe = async (fn) => { try { return await fn(); } catch { return null; } };

    return async function handleUsage({ appId, sub, method, query, readBody }) {
        if (!(await appStore.get(appId))) return json(404, { error: 'unknown_app' });

        if (sub === 'limits') {
            if (method === 'GET') {
                const overrides = await limitsStore.get(appId);
                return json(200, { defaults, overrides, limits: await limitsResolver.limitsFor(appId) });
            }
            if (method !== 'POST') return json(405, { error: 'method_not_allowed' });
            const body = await readBody(LIMITS_BODY_LIMIT);
            if (body.error) return json(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
            const v = validateOverrides(body.value.overrides);
            if (!v.ok) return json(400, { error: 'invalid_limits', problems: v.errors });
            if (!(await limitsStore.set(appId, v.overrides))) return json(404, { error: 'unknown_app' });
            limitsResolver.invalidate(appId);
            return json(200, { overrides: v.overrides, limits: await limitsResolver.limitsFor(appId) });
        }

        if (method !== 'GET') return json(405, { error: 'method_not_allowed' });
        const raw = query?.get('days');
        const days = raw === null || raw === undefined ? 7 : /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isInteger(days) || days < 1 || days > 30) return json(400, { error: 'invalid_days' });
        const day = today();
        const [rows, limits] = await Promise.all([usageStore.usageDaily(appId, { days, today: day }), limitsResolver.limitsFor(appId)]);
        const todayByKind = Object.fromEntries(rows.filter((r) => r.day === day).map((r) => [r.kind, r]));
        const stored = storageStore ? await safe(() => storageStore.usage({ appId })) : null;
        const spec = executor ? await safe(() => executor.peekSpec(appId)) : null;
        const tables = spec?.spec?.tables ? Object.keys(spec.spec.tables) : [];
        const usage = {
            rows: spec === null ? null : tables.length ? await safe(() => executor.totalRows(appId, tables)) : 0,
            storageBytes: stored ? stored.bytes : null,
            files: stored ? stored.files : null,
            callsToday: await safe(() => limiterStore.get(`calls:${appId}:${day}`)),
            spendMicrosToday: await safe(() => limiterStore.get(`spend:${appId}:${day}`)),
            emailsToday: emailsFrom(todayByKind),
            jobRunsToday: todayByKind.job?.calls || 0,
        };
        return json(200, buildUsageReport({ days, today: day, rows, limits, usage }));
    };
}
