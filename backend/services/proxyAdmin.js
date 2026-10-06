// Client for the vibe-proxy admin API (platform/proxy-app/admin.js). Write-only for secret values: there is no method that reads one.
import { sanitizeDestructive } from '../lib/schemaDestructive.js';

export class ProxyAdminError extends Error {
    constructor(status, code) {
        super(`proxy admin request failed (${code})`);
        this.name = 'ProxyAdminError';
        this.status = status;
        this.code = code;
        this.destructive = []; // set on destructive_change_needs_confirmation: [{ kind, table, column? }], names only
    }
}

export function createProxyAdmin({ baseUrl, token, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
    const configured = typeof baseUrl === 'string' && /^https:\/\/[^/]+/.test(baseUrl) && typeof token === 'string' && token.length >= 32;
    const root = configured ? baseUrl.replace(/\/+$/, '') : '';
    const enc = encodeURIComponent;

    async function call(method, path, body) {
        if (!configured) throw new ProxyAdminError(0, 'not_configured');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        let res;
        try {
            res = await fetchImpl(`${root}${path}`, {
                method,
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body),
                redirect: 'manual',
                signal: ctrl.signal,
            });
        } catch (e) {
            throw new ProxyAdminError(0, e?.name === 'AbortError' ? 'timeout' : 'unreachable');
        } finally {
            clearTimeout(timer);
        }
        if (res.status >= 200 && res.status < 300) return res.status === 204 ? null : res.json().catch(() => null);
        let code = `http_${res.status}`;
        let destructive = [];
        try {
            const j = await res.json();
            if (typeof j?.error === 'string' && /^[a-z_]{1,40}$/.test(j.error)) code = j.error;
            if (code === 'destructive_change_needs_confirmation') destructive = sanitizeDestructive(j.destructive);
        } catch { /* keep the generic code */ }
        const err = new ProxyAdminError(res.status, code);
        err.destructive = destructive;
        throw err;
    }

    return {
        configured,
        registerApp: (appId, { manifest = null, domains = [], enabled = true } = {}) => call('PUT', `/admin/apps/${enc(appId)}`, { manifest, domains, enabled }),
        setSecret: (appId, name, value) => call('PUT', `/admin/apps/${enc(appId)}/secrets/${enc(name)}`, { value }),
        deleteSecret: (appId, name) => call('DELETE', `/admin/apps/${enc(appId)}/secrets/${enc(name)}`),
        ensureApp: (appId) => call('POST', `/admin/apps/${enc(appId)}/ensure`),
        setEnabled: (appId, enabled) => call('POST', `/admin/apps/${enc(appId)}/enabled`, { enabled: !!enabled }),
        setDomains: (appId, domains) => call('POST', `/admin/apps/${enc(appId)}/domains`, { domains }),
        getApp: (appId) => call('GET', `/admin/apps/${enc(appId)}`),
        setManifest: (appId, manifest) => call('POST', `/admin/apps/${enc(appId)}/manifest`, { manifest }),
        // Applies a vibe.schema.json spec to the app's own database. Resolves { version, applied }; rejects with code invalid_schema,
        // destructive_change_needs_confirmation (nothing changed), migration_failed or unknown_app.
        setSchema: (appId, spec, { allowDestructive = false } = {}) => call('POST', `/admin/apps/${enc(appId)}/schema`, { spec, allowDestructive: allowDestructive === true }),
        // Dry run of setSchema with destructive changes planned as if confirmed. Writes nothing. Resolves { ok, statements, destructive }.
        planSchema: (appId, spec) => call('POST', `/admin/apps/${enc(appId)}/schema/plan`, { spec }),
        getSchema: (appId) => call('GET', `/admin/apps/${enc(appId)}/schema`),
        // Replaces the app's scheduled jobs with the contents of vibe.jobs.json ({ version?, jobs: [...] }, sent as is). Resolves
        // { jobs, warnings }; rejects with invalid_jobs (nothing changed), request_too_large, bad_app_manifest or unknown_app.
        setJobs: (appId, spec) => call('POST', `/admin/apps/${enc(appId)}/jobs`, spec),
        getJobs: (appId) => call('GET', `/admin/apps/${enc(appId)}/jobs`),
        copySecrets: (toAppId, fromAppId, { replace = false } = {}) => call('POST', `/admin/apps/${enc(toAppId)}/copy-secrets`, { from: fromAppId, replace }),
        // Per-app usage for the last `days` (1..30): { days: [{ day, byKind }], totals, limits, usage }, numbers only. Rejects with unknown_app or invalid_days.
        getUsage: (appId, days = 7) => call('GET', `/admin/apps/${enc(appId)}/usage?days=${enc(String(days))}`),
        listSecrets: async (appId) => (await call('GET', `/admin/apps/${enc(appId)}/secrets`))?.secrets ?? [],
    };
}
