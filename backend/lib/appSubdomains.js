// The apps that actually run a project are its preview and published subdomains; the SDK identifies an app by subdomain.
// Only single-label names under our own base domain count; anything else in those columns is ignored. Preview comes first,
// published last. Shared by the secrets and usage routes so both resolve a project's apps the same way.
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

export function appSubdomains(project, baseDomain) {
    const out = [];
    for (const u of [project.preview_url, project.published_url]) {
        let host;
        try { host = new URL(u).hostname.toLowerCase(); } catch { continue; }
        if (!host.endsWith(`.${baseDomain}`)) continue;
        const label = host.slice(0, -(baseDomain.length + 1));
        if (SUBDOMAIN.test(label) && !out.includes(label)) out.push(label);
    }
    return out;
}
