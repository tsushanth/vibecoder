// Reads the scheduled jobs file (vibe.jobs.json at the project root) out of a project's base64 zip bundle, with the same caps and
// safety as the schema reader. Only locates and parses; the platform proxy validates the jobs against the app's schema and connectors.
// The cap equals the proxy's jobs request limit (platform/jobs/admin.js JOBS_BODY_LIMIT), so anything bigger could never be accepted.
//   none        no such file: the caller leaves the app's existing jobs alone
//   unreadable  the bundle itself or the entry could not be read safely (including too big): also left alone
//   invalid     the file exists but is not a JSON object: reported to the creator, never sent
import { readRootFile } from './bundleZip.js';

export const JOBS_FILE = 'vibe.jobs.json';
export const MAX_JOBS_BYTES = 8192;

/** @returns {{status:'found', spec:object} | {status:'none'} | {status:'unreadable'} | {status:'invalid'}} */
export function jobsFromBundle(bundleBase64) {
    const f = readRootFile(bundleBase64, JOBS_FILE, MAX_JOBS_BYTES);
    if (f.status !== 'found') return { status: f.status };
    try {
        const parsed = JSON.parse(f.text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'invalid' };
        return { status: 'found', spec: parsed };
    } catch {
        return { status: 'invalid' };
    }
}
