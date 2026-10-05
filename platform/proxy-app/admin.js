// Service-to-service admin API: register apps and manage their secrets. Called by the VibeBuild backend after it has
// authenticated the creator and checked they own the app. Write-only for secrets: values can be set and deleted, never read.
import { createHash, timingSafeEqual } from 'node:crypto';
import { validateManifest } from '../vibe-proxy/manifest.js';
import { resolveManifest } from '../vibe-proxy/builtins.js';

const APP_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_FAILED_PER_MIN = 10;
const MAX_VALUE = 4096;
const MAX_DOMAINS = 5;

const digest = (s) => createHash('sha256').update(String(s)).digest();
const json = (status, body) => ({ status, body });
const noBody = (status) => ({ status });

export const ADMIN_BODY_LIMIT = 8192;

export function createAdmin({ token, appStore, upsertApp, ensureApp, setEnabled, setDomains, setManifest, copySecrets, secretStore, limiterStore, baseDomain, jobsAdmin, now = () => Date.now() }) {
    const expected = digest(token);
    const minute = () => Math.floor(now() / 60_000);
    const validDomains = (domains) => Array.isArray(domains) && domains.length <= MAX_DOMAINS && domains.every((d) => typeof d === 'string' && HOSTNAME.test(d) && !d.endsWith(`.${baseDomain}`) && d !== baseDomain);

    async function authorize(headers, ip) {
        const key = `adminfail:${ip}:${minute()}`;
        if ((await limiterStore.get(key)) >= MAX_FAILED_PER_MIN) return json(429, { error: 'too_many_attempts' });
        const m = /^Bearer (.+)$/.exec(headers.authorization || '');
        const ok = !!m && timingSafeEqual(digest(m[1]), expected);
        if (!ok) { await limiterStore.incr(key, 120); return json(401, { error: 'unauthorized' }); }
        return null;
    }

    /** req: { method, pathname, headers, ip, readBody(limit) -> { value } | { error: status } }. Returns { status, body? }. */
    return async function handle(req) {
        const denied = await authorize(req.headers, req.ip);
        if (denied) return denied;
        const m = /^\/admin\/apps\/([^/]+)(?:\/(secrets|ensure|enabled|domains|manifest|copy-secrets|jobs)(?:\/([^/]+))?)?$/.exec(req.pathname);
        if (!m) return json(404, { error: 'not_found' });
        const [, appId, sub, name] = m;
        if (!APP_ID.test(appId)) return json(404, { error: 'not_found' });

        if (!sub && req.method === 'GET') {
            // what the app declares, for the key-entry screen: connector names, hosts and which secret each needs. Never a value.
            const app = await appStore.get(appId);
            if (!app) return json(404, { error: 'unknown_app' });
            const connectors = Object.entries(app.manifest?.connectors || {}).map(([name, c]) => ({ name, host: c.host, secret: c.secret ? { name: c.secret.name, in: c.secret.in } : null }));
            return json(200, { enabled: app.enabled, connectors });
        }

        if (!sub) {
            if (req.method !== 'PUT') return json(405, { error: 'method_not_allowed' });
            const body = await req.readBody(ADMIN_BODY_LIMIT);
            if (body.error) return json(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
            const { manifest = null, domains = [], enabled = true } = body.value;
            if (typeof enabled !== 'boolean') return json(400, { error: 'invalid_enabled' });
            if (!validDomains(domains)) return json(400, { error: 'invalid_domains' });
            if (manifest !== null) {
                if (typeof manifest !== 'object' || Array.isArray(manifest)) return json(400, { error: 'invalid_manifest', problems: ['manifest must be an object'] });
                const v = validateManifest(manifest);
                if (!v.ok) return json(400, { error: 'invalid_manifest', problems: v.problems.slice(0, 10) });
                try { resolveManifest(manifest); } catch (e) { return json(400, { error: 'invalid_manifest', problems: [e.message] }); }
            }
            await upsertApp({ appId, manifest, domains, enabled });
            return noBody(204);
        }

        if (sub === 'manifest') {
            if (name !== undefined) return json(404, { error: 'not_found' });
            if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
            const body = await req.readBody(ADMIN_BODY_LIMIT);
            if (body.error) return json(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
            const manifest = body.value.manifest;
            if (manifest === undefined || (manifest !== null && (typeof manifest !== 'object' || Array.isArray(manifest)))) return json(400, { error: 'invalid_manifest', problems: ['manifest must be an object or null'] });
            if (manifest !== null) {
                const v = validateManifest(manifest);
                if (!v.ok) return json(400, { error: 'invalid_manifest', problems: v.problems.slice(0, 10) });
                try { resolveManifest(manifest); } catch (e) { return json(400, { error: 'invalid_manifest', problems: [e.message] }); }
            }
            if (!(await setManifest(appId, manifest))) return json(404, { error: 'unknown_app' });
            return noBody(204);
        }

        if (sub === 'jobs') {
            if (name !== undefined || !jobsAdmin) return json(404, { error: 'not_found' });
            return jobsAdmin({ appId, method: req.method, readBody: req.readBody });   // validation and storage live in ../jobs/admin.js
        }

        if (sub === 'copy-secrets') {
            if (name !== undefined) return json(404, { error: 'not_found' });
            if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
            const body = await req.readBody(ADMIN_BODY_LIMIT);
            if (body.error) return json(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
            const from = body.value.from;
            const replace = body.value.replace ?? false;
            if (typeof from !== 'string' || !APP_ID.test(from) || from === appId || typeof replace !== 'boolean') return json(400, { error: 'invalid_source' });
            if (!(await appStore.get(appId)) || !(await appStore.get(from))) return json(404, { error: 'unknown_app' });
            return json(200, { copied: await copySecrets(from, appId, { replace }) });
        }

        if (sub === 'ensure' || sub === 'enabled' || sub === 'domains') {
            if (name !== undefined) return json(404, { error: 'not_found' });
            if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
            if (sub === 'ensure') { await ensureApp({ appId }); return noBody(204); }   // creates if missing; never changes an existing app
            if (sub === 'domains') {
                const body = await req.readBody(ADMIN_BODY_LIMIT);
                if (body.error) return json(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
                if (!validDomains(body.value.domains)) return json(400, { error: 'invalid_domains' });
                if (!(await setDomains(appId, body.value.domains))) return json(404, { error: 'unknown_app' });
                return noBody(204);
            }
            const body = await req.readBody(ADMIN_BODY_LIMIT);
            if (body.error) return json(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
            if (typeof body.value.enabled !== 'boolean') return json(400, { error: 'invalid_enabled' });
            if (!(await setEnabled(appId, body.value.enabled))) return json(404, { error: 'unknown_app' });
            return noBody(204);
        }

        if (!(await appStore.get(appId))) return json(404, { error: 'unknown_app' });
        if (name === undefined) {
            if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
            const rows = await secretStore.list(appId);
            return json(200, { secrets: rows.map((r) => ({ name: r.name, updatedAt: r.updatedAt })) });
        }
        if (!SECRET_NAME.test(name)) return json(400, { error: 'invalid_secret_name' });
        if (req.method === 'DELETE') { await secretStore.delete(appId, name); return noBody(204); }
        if (req.method !== 'PUT') return json(405, { error: 'method_not_allowed' });
        const body = await req.readBody(ADMIN_BODY_LIMIT);
        if (body.error) return json(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
        const value = body.value.value;
        if (typeof value !== 'string' || !value.length || value.length > MAX_VALUE) return json(400, { error: 'invalid_value' });
        await secretStore.set(appId, name, value);
        return noBody(204);
    };
}
