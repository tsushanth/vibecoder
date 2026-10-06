import express from 'express';
import rateLimit from 'express-rate-limit';
import { supabase as defaultSupabase } from '../config/database.js';
import { verifiedUserId } from '../lib/verifiedUser.js';
import { schemaFromBundle } from '../lib/bundleSchema.js';
import { sanitizeDestructive } from '../lib/schemaDestructive.js';
import { WORKER_URL, WORKER_SECRET } from '../config/constants.js';

// Dry run of a deploy's schema change, for the confirmation dialog:
//   GET /api/projects/:id/schema/plan?subdomain=<the app's subdomain>
// Reads the project's current bundle (latest from git when the project has a repo, like a deploy does), takes its vibe.schema.json
// and asks the platform proxy what applying it to the live database would change. NOTHING is applied or provisioned.
// Identity comes only from the verified Supabase token and must be the project's owner (same rule as the secrets routes).
// Answers (names only, never data):
//   { hasSchema: false }                                          the bundle has no readable schema
//   { hasSchema: true, existing: false, statements: 0, destructive: [] }   that subdomain has no deployment of this project yet
//   { hasSchema: true, existing: true, status: 'ok', statements, destructive: [{kind, table, column?}] }
//   { hasSchema: true, existing: true, status: 'invalid' }        the schema is not valid (generic; details come from the deploy)
const PROJECT_ID = /^[A-Za-z0-9-]{8,64}$/;
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

export function createSchemaPlanRouter({ supabase = defaultSupabase, verifyUser = verifiedUserId, proxyAdmin, fetchImpl = globalThis.fetch, log = console.error, maxPerMinute = 30 }) {
    const router = express.Router({ mergeParams: true });
    router.use(rateLimit({ windowMs: 60_000, limit: maxPerMinute, standardHeaders: false, legacyHeaders: false, message: { error: 'rate_limited' } }));
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    router.get('/plan', async (req, res) => {
        const uid = await verifyUser(req);
        if (!uid) return res.status(401).json({ error: 'unauthorized' });
        if (!proxyAdmin?.configured) return res.status(503).json({ error: 'schema_unavailable' });
        const id = req.params.id;
        const subdomain = req.query.subdomain;
        if (!PROJECT_ID.test(id)) return res.status(404).json({ error: 'not_found' });
        if (typeof subdomain !== 'string' || !SUBDOMAIN.test(subdomain)) return res.status(400).json({ error: 'invalid_subdomain' });
        const { data: project, error } = await supabase.from('projects').select('bundle, creator_id, github_repo').eq('id', id).single();
        if (error || !project) return res.status(404).json({ error: 'not_found' });
        if (project.creator_id !== uid) return res.status(403).json({ error: 'forbidden' });

        let bundle = project.bundle;
        if (project.github_repo) {
            try {
                const r = await fetchImpl(`${WORKER_URL}/bundle/${project.github_repo}`, { headers: { 'x-worker-secret': WORKER_SECRET }, signal: AbortSignal.timeout(60000) });
                if (r.ok) { const j = await r.json(); if (j?.bundle) bundle = j.bundle; }
            } catch { /* fall back to the stored bundle, as the deploy does */ }
        }
        const found = bundle ? schemaFromBundle(bundle) : { status: 'none' };
        if (found.status !== 'found') return res.json({ hasSchema: false });

        const { data: dep } = await supabase.from('deployments').select('id').eq('subdomain', subdomain).eq('project_id', id).single();
        if (!dep) return res.json({ hasSchema: true, existing: false, statements: 0, destructive: [] });

        try {
            const out = await proxyAdmin.planSchema(subdomain, found.spec);
            return res.json({ hasSchema: true, existing: true, status: 'ok', statements: Number.isInteger(out?.statements) ? out.statements : 0, destructive: sanitizeDestructive(out?.destructive) });
        } catch (e) {
            if (e?.code === 'invalid_schema') return res.json({ hasSchema: true, existing: true, status: 'invalid' });
            if (e?.code === 'unknown_app') return res.json({ hasSchema: true, existing: false, statements: 0, destructive: [] });
            log(`[schema-plan] failed project=${id} code=${e?.code || 'error'}`);
            return res.status(502).json({ error: 'plan_unavailable' });
        }
    });

    return router;
}
