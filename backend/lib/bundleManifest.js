// Reads the connector manifest (vibe.manifest.json at the project root) out of a project's base64 zip bundle, so the backend can
// register it with the platform proxy. The proxy validates the manifest again when it is registered; this only locates and parses it.
import { readRootFile } from './bundleZip.js';

export const MANIFEST_FILE = 'vibe.manifest.json';
const MAX_MANIFEST_BYTES = 8192;

/** @returns {{status:'found', manifest:object} | {status:'none'} | {status:'unreadable'}} */
export function manifestFromBundle(bundleBase64) {
    const f = readRootFile(bundleBase64, MANIFEST_FILE, MAX_MANIFEST_BYTES);
    if (f.status !== 'found') return { status: f.status };
    try {
        const parsed = JSON.parse(f.text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'unreadable' };
        // a payments-only app has a pay section and no connectors; the proxy validates the pay catalog itself
        const hasPay = !!parsed.pay && typeof parsed.pay === 'object' && !Array.isArray(parsed.pay);
        const c = parsed.connectors;
        const connectorsOk = c !== undefined ? (!!c && typeof c === 'object' && !Array.isArray(c)) : hasPay;
        if (!connectorsOk) return { status: 'unreadable' };
        return hasPay || Object.keys(c).length ? { status: 'found', manifest: parsed } : { status: 'none' };
    } catch {
        return { status: 'unreadable' };
    }
}
