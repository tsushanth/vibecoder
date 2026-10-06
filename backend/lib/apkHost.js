// The origin an exported APK serves its app from: the project's published subdomain if it has one, else its preview
// subdomain. Only single-label names under our own base domain count; null means "use the legacy file:// shell".
const LABEL = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

export function apkHostFor(project, baseDomain = process.env.BASE_DOMAIN || 'vibebuild.cc') {
    for (const u of [project?.published_url, project?.preview_url]) {
        let host;
        try { host = new URL(u).hostname; } catch { continue; }
        if (!host.endsWith(`.${baseDomain}`)) continue;
        const label = host.slice(0, -(baseDomain.length + 1));
        if (LABEL.test(label)) return host;
    }
    return null;
}
