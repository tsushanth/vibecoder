// Reads the data schema (vibe.schema.json at the project root) out of a project's base64 zip bundle, with the same caps and
// safety as the manifest reader. Only locates and parses; the platform proxy validates the spec before anything touches a database.
// "none" and "unreadable" both mean the caller must leave the app's existing database alone.
import { readRootFile } from './bundleZip.js';

export const SCHEMA_FILE = 'vibe.schema.json';
export const MAX_SCHEMA_BYTES = 65536;

/** @returns {{status:'found', spec:object} | {status:'none'} | {status:'unreadable'}} */
export function schemaFromBundle(bundleBase64) {
    const f = readRootFile(bundleBase64, SCHEMA_FILE, MAX_SCHEMA_BYTES);
    if (f.status !== 'found') return { status: f.status };
    try {
        const parsed = JSON.parse(f.text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'unreadable' };
        return { status: 'found', spec: parsed };
    } catch {
        return { status: 'unreadable' };
    }
}
