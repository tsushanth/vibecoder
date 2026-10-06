// Helpers for the APK export. The host is the origin the exported app is served from (https://<host>/), which must be a
// platform subdomain: the proxy only accepts requests whose Origin is the app's own <app>.<base domain>.
const HOST = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]\.vibebuild\.cc$/;

export const validApkHost = (h) => typeof h === 'string' && HOST.test(h);

/** Sets the vibe_host string in the template's strings.xml. Throws if the template no longer has the placeholder. */
export function applyApkHost(stringsXml, host) {
    if (!validApkHost(host)) throw new Error('invalid apk host');
    const re = /(<string name="vibe_host" translatable="false">)(<\/string>)/;
    if (!re.test(stringsXml)) throw new Error('template has no vibe_host placeholder');
    return stringsXml.replace(re, `$1${host}$2`);
}

const CAP_PLACEHOLDER = '__VIBE_HOST__';

/**
 * Fills the host placeholder of the Capacitor template's capacitor.config.json (server.hostname) and returns the new JSON text.
 * The host must pass validApkHost. The result is also checked against the invariants that keep the native bridge scoped to
 * that one origin: https scheme, no server.url, no allowNavigation entries, no cleartext. A template that drifts from
 * them throws instead of producing an APK.
 */
export function applyCapacitorHost(configJson, host) {
    if (!validApkHost(host)) throw new Error('invalid apk host');
    let cfg;
    try { cfg = JSON.parse(configJson); } catch { throw new Error('capacitor config is not valid JSON'); }
    const server = cfg && typeof cfg === 'object' ? cfg.server : undefined;
    if (!server || typeof server !== 'object' || server.hostname !== CAP_PLACEHOLDER) throw new Error('template has no hostname placeholder');
    if (server.androidScheme !== 'https') throw new Error('capacitor config must use the https scheme');
    if (server.url !== undefined) throw new Error('capacitor config must not set server.url');
    if (server.allowNavigation !== undefined && !(Array.isArray(server.allowNavigation) && server.allowNavigation.length === 0)) throw new Error('capacitor config must not set server.allowNavigation');
    if (server.cleartext === true) throw new Error('capacitor config must not allow cleartext');
    server.hostname = host;
    return JSON.stringify(cfg, null, 2) + '\n';
}
