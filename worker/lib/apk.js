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
