// Connector manifests for generated apps: the model declares third-party APIs (with where the creator's key goes) and the payment
// catalog (pay.catalog, validated by the vendored platform/pay/catalog.js through the manifest validator) in vibe.manifest.json. The manifest is untrusted model output: it is validated here with a vendored copy of the platform's own
// validator (lib/vendor/manifest.js, kept byte-identical by a test), normalised, and only the normalised form is ever written.
// The proxy validates again when the backend registers it, so this is the early, fixable check, not the only one.
import { validateManifest } from './vendor/manifest.js';

export const MANIFEST_FILE = 'vibe.manifest.json';
export const MAX_APP_CONNECTORS = 5;
const MAX_BYTES = 8192;
// Built-in connector names the proxy offers every app (platform/vibe-proxy/builtins.js). An app may not redefine them. Keep in sync.
export const KNOWN_CONNECTORS = ['nws'];

const fail = (...problems) => ({ ok: false, manifest: null, problems });

/** Returns { ok, manifest, problems }. ok with manifest null means "declares nothing". Never throws. */
export function parseManifestFile(text) {
    if (typeof text !== 'string' || !text.trim()) return fail('vibe.manifest.json is empty');
    if (Buffer.byteLength(text) > MAX_BYTES) return fail(`vibe.manifest.json is too large (max ${MAX_BYTES} bytes)`);
    let raw;
    try { raw = JSON.parse(text); } catch { return fail('vibe.manifest.json is not valid JSON'); }
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const hasPay = isObj(raw) && raw.pay !== undefined;
    if (!isObj(raw) || (hasPay ? raw.connectors !== undefined && !isObj(raw.connectors) : !isObj(raw.connectors))) {
        return fail('vibe.manifest.json must be a JSON object with a "connectors" object and/or a "pay" object');
    }
    const entries = Object.entries(raw.connectors || {});
    if (!entries.length && !hasPay) return { ok: true, manifest: null, problems: [] };
    if (entries.length > MAX_APP_CONNECTORS) return fail(`too many connectors (max ${MAX_APP_CONNECTORS} per app)`);
    const v = validateManifest(raw);
    const problems = [...v.problems];
    for (const [name] of entries) if (KNOWN_CONNECTORS.includes(name)) problems.push(`connector name "${name}" is a built-in and cannot be redefined`);
    if (problems.length) return fail(...problems.slice(0, 10));

    // one key must not be sent to two different services
    const hostOfSecret = new Map();
    for (const [name, c] of entries) {
        if (!c.secret) continue;
        const host = c.host.toLowerCase();
        if (hostOfSecret.has(c.secret.name) && hostOfSecret.get(c.secret.name) !== host) {
            return fail(`secret ${c.secret.name} is used by connectors on different hosts; use a different secret name for each service (connector "${name}")`);
        }
        hostOfSecret.set(c.secret.name, host);
    }

    const connectors = {};
    for (const [name, c] of entries) {
        const out = { host: c.host.toLowerCase(), paths: [...c.paths], methods: [...c.methods] };
        if (c.secret) out.secret = { name: c.secret.name, in: c.secret.in, field: c.secret.field };
        connectors[name] = out;
    }
    const manifest = { connectors };
    if (hasPay) {
        manifest.pay = { catalog: raw.pay.catalog.map((it) => {
            const out = { id: it.id, name: it.name, amountCents: it.amountCents, currency: it.currency, mode: it.mode };
            if (it.interval !== undefined) out.interval = it.interval;
            if (it.maxQuantity !== undefined) out.maxQuantity = it.maxQuantity;
            return out;
        }) };
    }
    return { ok: true, manifest, problems: [] };
}

/** The pay catalog the project's root manifest declares: { state: 'none' | 'invalid' | 'ok', catalog: [] }. */
export function declaredCatalog(files) {
    const text = files?.[MANIFEST_FILE];
    if (typeof text !== 'string') return { state: 'none', catalog: [] };
    const r = parseManifestFile(text);
    if (!r.ok) return { state: 'invalid', catalog: [] };
    return r.manifest?.pay ? { state: 'ok', catalog: r.manifest.pay.catalog } : { state: 'none', catalog: [] };
}

/** Connector names the project's root manifest declares (best effort, for cross-checking app code). */
export function declaredConnectors(files) {
    const text = files?.[MANIFEST_FILE];
    if (typeof text !== 'string') return [];
    const r = parseManifestFile(text);
    if (r.ok) return r.manifest ? Object.keys(r.manifest.connectors) : [];
    return [];
}

/** Names written in the manifest even if it is invalid, so one bad manifest does not also report every call as unknown. */
export function rawConnectorNames(text) {
    try {
        const c = JSON.parse(text)?.connectors;
        return c && typeof c === 'object' && !Array.isArray(c) ? Object.keys(c) : [];
    } catch { return []; }
}
