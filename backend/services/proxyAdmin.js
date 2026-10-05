// Client for the vibe-proxy admin API (platform/proxy-app/admin.js). Write-only for secret values: there is no method that reads one.
export class ProxyAdminError extends Error {
    constructor(status, code) {
        super(`proxy admin request failed (${code})`);
        this.name = 'ProxyAdminError';
        this.status = status;
        this.code = code;
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
        try { const j = await res.json(); if (typeof j?.error === 'string' && /^[a-z_]{1,40}$/.test(j.error)) code = j.error; } catch { /* keep the generic code */ }
        throw new ProxyAdminError(res.status, code);
    }

    return {
        configured,
        registerApp: (appId, { manifest = null, domains = [], enabled = true } = {}) => call('PUT', `/admin/apps/${enc(appId)}`, { manifest, domains, enabled }),
        setSecret: (appId, name, value) => call('PUT', `/admin/apps/${enc(appId)}/secrets/${enc(name)}`, { value }),
        deleteSecret: (appId, name) => call('DELETE', `/admin/apps/${enc(appId)}/secrets/${enc(name)}`),
        ensureApp: (appId) => call('POST', `/admin/apps/${enc(appId)}/ensure`),
        setEnabled: (appId, enabled) => call('POST', `/admin/apps/${enc(appId)}/enabled`, { enabled: !!enabled }),
        listSecrets: async (appId) => (await call('GET', `/admin/apps/${enc(appId)}/secrets`))?.secrets ?? [],
    };
}
