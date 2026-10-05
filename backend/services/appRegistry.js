// Keeps the platform proxy's app registry in step with deployments: a deployed app is registered (created if missing,
// never overwritten) and enabled; an undeployed app is switched off. Best effort: a proxy problem is logged by error code
// only and never fails a deploy.
import { manifestFromBundle } from '../lib/bundleManifest.js';

const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

// With `source` = { projectId, bundle } it also carries the project's connector manifest and keys over:
//   - the manifest in the bundle (vibe.manifest.json) is registered on the subdomain app and on the project-id app, which is the
//     canonical holder of the project's manifest and keys (the key-entry routes write there) and is never enabled for calls;
//   - the project's keys are copied onto the subdomain app, replacing whatever it held, so a reused subdomain cannot keep a
//     previous owner's keys.
// A bundle that cannot be read leaves the registered manifest alone. Manifest or key failures are logged by code and never stop
// the app from being enabled.
const PROJECT_ID = /^[A-Za-z0-9-]{8,64}$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

//
// Schemas (vibe.schema.json) work differently from keys: the data lives in a per-app database keyed by the app id the browser calls,
// i.e. the subdomain app, so there is nothing to hold under the project-id app and nothing to copy. The schema is pushed to each
// subdomain app being deployed (so a preview and the published app have separate databases and a preview can never touch live data).
// It is never destructive unless `source.allowDestructive === true` (the creator confirmed). A bundle without a schema, or one that
// cannot be read, leaves the existing database alone. A failed push never fails the deploy and is logged by code only; its outcome
// is written to `source.result.schemaStatus` ('applied' | 'unchanged' | 'invalid' | 'needs_confirmation' | 'failed') when a result
// object is given. Absent when the bundle has no readable schema.
import { schemaFromBundle } from '../lib/bundleSchema.js';

export async function pushAppSchema(proxyAdmin, subdomain, bundle, { allowDestructive = false, log = console.warn } = {}) {
    const found = schemaFromBundle(bundle);
    if (found.status !== 'found') return null;
    try {
        const out = await proxyAdmin.setSchema(subdomain, found.spec, { allowDestructive: allowDestructive === true });
        return out?.applied > 0 ? 'applied' : 'unchanged';
    } catch (e) {
        const code = e?.code || 'error';
        log(`[proxy] schema failed app=${subdomain} code=${code}`);
        if (code === 'invalid_schema' || code === 'invalid_allow_destructive') return 'invalid';
        if (code === 'destructive_change_needs_confirmation') return 'needs_confirmation';
        return 'failed';
    }
}

export async function registerDeployedApp(proxyAdmin, subdomain, log = console.warn, source = {}) {
    if (!proxyAdmin?.configured || typeof subdomain !== 'string' || !SUBDOMAIN.test(subdomain)) return false;
    if (UUID_LIKE.test(subdomain)) return false; // project ids are the platform's own app ids
    const projectId = typeof source?.projectId === 'string' && PROJECT_ID.test(source.projectId) ? source.projectId : null;
    const found = projectId && source.bundle ? manifestFromBundle(source.bundle) : { status: 'unreadable' };
    const step = async (what, fn) => {
        try { await fn(); } catch (e) { if (e?.code !== 'unknown_app' || what !== 'clear') log(`[proxy] ${what} failed app=${subdomain} code=${e?.code || 'error'}`); }
    };
    try {
        await proxyAdmin.ensureApp(subdomain);
        if (found.status === 'found') {
            await step('project app', async () => { await proxyAdmin.ensureApp(projectId); await proxyAdmin.setEnabled(projectId, false); });
            await step('manifest', async () => { await proxyAdmin.setManifest(projectId, found.manifest); await proxyAdmin.setManifest(subdomain, found.manifest); });
            await step('keys', () => proxyAdmin.copySecrets(subdomain, projectId, { replace: true }));
        } else if (found.status === 'none') {
            await step('clear', async () => { await proxyAdmin.setManifest(subdomain, null); });
            await step('clear', async () => { await proxyAdmin.setManifest(projectId, null); });
        }
        if (source?.bundle) {
            const status = await pushAppSchema(proxyAdmin, subdomain, source.bundle, { allowDestructive: source.allowDestructive === true, log });
            if (status && source.result && typeof source.result === 'object') source.result.schemaStatus = status;
        }
        await proxyAdmin.setEnabled(subdomain, true);
        return true;
    } catch (e) {
        log(`[proxy] register failed app=${subdomain} code=${e?.code || 'error'}`);
        return false;
    }
}

export async function disableDeployedApp(proxyAdmin, subdomain, log = console.warn) {
    if (!proxyAdmin?.configured || typeof subdomain !== 'string' || !SUBDOMAIN.test(subdomain)) return false;
    try {
        await proxyAdmin.setEnabled(subdomain, false);
        return true;
    } catch (e) {
        if (e?.code === 'unknown_app') return true; // never registered, so already off
        log(`[proxy] disable failed app=${subdomain} code=${e?.code || 'error'}`);
        return false;
    }
}

// Tells the proxy an app's custom domain (or none), so the SDK works when the app is served from it. Best effort.
export async function syncCustomDomain(proxyAdmin, { subdomain, domain } = {}, log = console.warn) {
    if (!proxyAdmin?.configured || typeof subdomain !== 'string' || !SUBDOMAIN.test(subdomain)) return false;
    if (domain !== null && typeof domain !== 'string') return false;
    try {
        await proxyAdmin.ensureApp(subdomain);
        await proxyAdmin.setDomains(subdomain, domain ? [domain] : []);
        return true;
    } catch (e) {
        log(`[proxy] custom domain sync failed app=${subdomain} code=${e?.code || 'error'}`);
        return false;
    }
}
