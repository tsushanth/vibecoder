// Takes published (and preview) sites off the deploy server when the owner unpublishes, deletes a project or deletes an account.
// Removal is idempotent (the deploy server answers 200 for a name that has no files, and a 404 is treated the same), and it never
// throws: a deploy-server outage is logged and reported, and the caller carries on so the user's own delete is never blocked.
import { DEPLOY_SERVER_URL } from '../config/constants.js';
import { deployServerHeaders } from './deployServerAuth.js';
import { reportFailure } from './failureReporter.js';
import { disableDeployedApp } from '../services/appRegistry.js';

const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;
const PREVIEW = /^preview-[a-z0-9-]+$/;

/** The subdomains to take down for a project: its deployment rows (any status, so a repeated unpublish retries) plus its preview. */
export function projectSiteSubdomains({ deployments = [], previewUrl = null } = {}, baseDomain = process.env.BASE_DOMAIN || 'vibebuild.cc') {
    const out = [];
    const add = (s) => { if (typeof s === 'string') { const v = s.toLowerCase().trim(); if (SUBDOMAIN.test(v) && !out.includes(v)) out.push(v); } };
    for (const d of deployments || []) add(d?.subdomain);
    try {
        const host = new URL(previewUrl).hostname.toLowerCase();
        if (host.endsWith(`.${baseDomain}`)) {
            const label = host.slice(0, -(baseDomain.length + 1));
            if (PREVIEW.test(label)) add(label);
        }
    } catch { /* no preview */ }
    return out;
}

/** Removes each subdomain from the deploy server. Returns { removed, failed } (arrays of names); never throws. */
export async function removeSites(subdomains, { fetchImpl = globalThis.fetch, baseUrl = DEPLOY_SERVER_URL, log = console.warn, timeoutMs = 10000 } = {}) {
    const names = [...new Set((subdomains || []).filter((s) => typeof s === 'string' && SUBDOMAIN.test(s)))];
    const removed = []; const failed = [];
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        try {
            const r = await fetchImpl(`${baseUrl}/deploy/${encodeURIComponent(name)}`, { method: 'DELETE', headers: deployServerHeaders(), signal: AbortSignal.timeout(timeoutMs) });
            if (r.ok || r.status === 404) removed.push(name);
            else { failed.push(name); log(`[site-removal] deploy server answered ${r.status} for ${name}`); }
        } catch (e) {
            // Unreachable or timing out: stop here rather than waiting out the timeout once per remaining site.
            failed.push(...names.slice(i));
            log(`[site-removal] could not reach the deploy server (${e?.message || 'error'}); ${names.length - i} site(s) not removed`);
            break;
        }
    }
    if (failed.length) reportFailure('deploy:site_removal', new Error('site removal failed'), { failed: String(failed.length), total: String(names.length) });
    return { removed, failed };
}

/** Switches the data-proxy app of each subdomain off, so a deleted site's backing app stops answering. Idempotent (an app that was
 *  never registered, or is already off, counts as done), runs every name, and never throws. Returns { disabled, failed }. */
export async function disableSiteApps(proxyAdmin, subdomains, { log = console.warn } = {}) {
    const disabled = []; const failed = [];
    for (const name of [...new Set(subdomains || [])]) {
        let ok = false;
        try { ok = await disableDeployedApp(proxyAdmin, name, log); } catch { ok = false; }
        // disableDeployedApp is false both for a proxy failure and when the proxy is not configured or the name is not valid.
        (ok ? disabled : failed).push(name);
    }
    return { disabled, failed };
}
