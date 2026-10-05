// Admin handler for POST/GET /admin/apps/:app/jobs. Authentication, rate limiting of failed attempts and routing live in
// proxy-app/admin.js, which calls this after the bearer token has been checked. Same request shape as there:
// { method, readBody(limit) -> { value } | { error: status } } in, { status, body } out.
import { validateJobs } from './validate.js';
import { resolveManifest } from '../vibe-proxy/builtins.js';

export const JOBS_BODY_LIMIT = 8192;
const json = (status, body) => ({ status, body });

export function createJobsAdmin({ store, appStore }) {
    return async function handleJobs({ appId, method, readBody }) {
        if (method !== 'GET' && method !== 'POST') return json(405, { error: 'method_not_allowed' });
        const app = await appStore.get(appId);
        if (!app) return json(404, { error: 'unknown_app' });
        if (method === 'GET') return json(200, { jobs: await store.getJobs(appId), runs: await store.recentRuns(appId) });

        const body = await readBody(JOBS_BODY_LIMIT);
        if (body.error) return json(body.error, { error: body.error === 413 ? 'request_too_large' : 'bad_json' });
        let connectors;
        try { connectors = resolveManifest(app.manifest?.connectors && Object.keys(app.manifest.connectors).length ? app.manifest : null).connectors; } catch { return json(500, { error: 'bad_app_manifest' }); }
        const spec = await store.getSpec(appId);
        const v = validateJobs(body.value, { tables: spec?.tables || {}, connectors });
        if (!v.ok) return json(400, { error: 'invalid_jobs', problems: v.errors.slice(0, 20) });
        await store.setJobs(appId, v.jobs);
        return json(200, { jobs: v.jobs.length, warnings: v.warnings });
    };
}
