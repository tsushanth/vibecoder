// Platform-defined connectors available to every app with no key. Each one must carry its terms review:
// a source URL, the date it was read, and confirmation that commercial use is allowed (see docs/superpowers/decisions).
export const BUILTIN_CONNECTORS = {
    nws: {
        host: 'api.weather.gov',
        paths: ['/points/*', '/gridpoints/*', '/alerts/active*'],
        methods: ['GET'],
        headers: { 'user-agent': 'VibeBuild vibe-proxy/1.0' },
        terms: { url: 'https://www.weather.gov/documentation/services-web-api', reviewedOn: '2026-10-04', commercialUse: true },
    },
};

/** Adds the built-ins to an app's manifest. An app may not define a connector with a built-in name. */
export function resolveManifest(appManifest) {
    const own = appManifest?.connectors || {};
    for (const name of Object.keys(own)) if (name in BUILTIN_CONNECTORS) throw new Error(`connector name "${name}" is reserved for a built-in`);
    return { connectors: { ...BUILTIN_CONNECTORS, ...own } };
}
