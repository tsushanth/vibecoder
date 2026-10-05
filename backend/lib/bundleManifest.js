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
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.connectors || typeof parsed.connectors !== 'object' || Array.isArray(parsed.connectors)) return { status: 'unreadable' };
        return Object.keys(parsed.connectors).length ? { status: 'found', manifest: parsed } : { status: 'none' };
    } catch {
        return { status: 'unreadable' };
    }
}
