// Keeps the platform proxy's app registry in step with deployments: a deployed app is registered (created if missing,
// never overwritten) and enabled; an undeployed app is switched off. Best effort: a proxy problem is logged by error code
// only and never fails a deploy.
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

export async function registerDeployedApp(proxyAdmin, subdomain, log = console.warn) {
    if (!proxyAdmin?.configured || typeof subdomain !== 'string' || !SUBDOMAIN.test(subdomain)) return false;
    try {
        await proxyAdmin.ensureApp(subdomain);
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
