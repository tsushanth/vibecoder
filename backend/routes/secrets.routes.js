import express from 'express';
import rateLimit from 'express-rate-limit';
import { supabase as defaultSupabase } from '../config/database.js';
import { verifiedUserId } from '../lib/verifiedUser.js';

// Key entry for generated apps: a creator stores API keys that the platform proxy injects server-side.
//   GET    /api/projects/:id/secrets          names and update times only
//   PUT    /api/projects/:id/secrets/:name    body {"value": "..."}  (write-only)
//   DELETE /api/projects/:id/secrets/:name
// Identity comes ONLY from the caller's verified Supabase access token (lib/verifiedUser.js); a userId in the request body,
// query or headers is never used. A secret value is never returned, logged or included in an error.
const PROJECT_ID = /^[A-Za-z0-9-]{8,64}$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_VALUE = 4096;

export function createSecretsRouter({ supabase = defaultSupabase, verifyUser = verifiedUserId, proxyAdmin, log = console.error, maxPerMinute = 60 }) {
    const router = express.Router({ mergeParams: true });
    const fail = (res, op, id, e) => {
        log(`[secrets] ${op} failed project=${id} code=${e?.code || 'error'}`);
        return res.status(502).json({ error: 'secret_store_unavailable' });
    };

    router.use(rateLimit({ windowMs: 60_000, limit: maxPerMinute, standardHeaders: false, legacyHeaders: false, message: { error: 'rate_limited' } }));
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    router.use(async (req, res, next) => {
        const uid = await verifyUser(req);
        if (!uid) return res.status(401).json({ error: 'unauthorized' });
        if (!proxyAdmin?.configured) return res.status(503).json({ error: 'secrets_unavailable' });
        const id = req.params.id;
        if (!PROJECT_ID.test(id)) return res.status(404).json({ error: 'not_found' });
        const { data: project, error } = await supabase.from('projects').select('id, creator_id').eq('id', id).single();
        if (error || !project) return res.status(404).json({ error: 'not_found' });
        if (project.creator_id !== uid) return res.status(403).json({ error: 'forbidden' });
        req.projectId = id;
        next();
    });

    router.use(express.json({ limit: '8kb' }));

    router.get('/', async (req, res) => {
        try {
            res.json({ secrets: await proxyAdmin.listSecrets(req.projectId) });
        } catch (e) {
            if (e?.code === 'unknown_app') return res.json({ secrets: [] });
            fail(res, 'list', req.projectId, e);
        }
    });

    router.put('/:name', async (req, res) => {
        const { name } = req.params;
        const value = req.body?.value;
        if (!SECRET_NAME.test(name)) return res.status(400).json({ error: 'invalid_secret_name' });
        if (typeof value !== 'string' || !value.length || value.length > MAX_VALUE) return res.status(400).json({ error: 'invalid_value' });
        try {
            try {
                await proxyAdmin.setSecret(req.projectId, name, value);
            } catch (e) {
                if (e?.code !== 'unknown_app') throw e;
                await proxyAdmin.registerApp(req.projectId, { manifest: null, domains: [], enabled: true });
                await proxyAdmin.setSecret(req.projectId, name, value);
            }
            log(`[secrets] set project=${req.projectId} name=${name}`);
            res.status(204).end();
        } catch (e) {
            fail(res, 'set', req.projectId, e);
        }
    });

    router.delete('/:name', async (req, res) => {
        const { name } = req.params;
        if (!SECRET_NAME.test(name)) return res.status(400).json({ error: 'invalid_secret_name' });
        try {
            await proxyAdmin.deleteSecret(req.projectId, name);
        } catch (e) {
            if (e?.code !== 'unknown_app') return fail(res, 'delete', req.projectId, e);
        }
        log(`[secrets] delete project=${req.projectId} name=${name}`);
        res.status(204).end();
    });

    router.use((err, req, res, next) => {
        if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'request_too_large' });
        if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) return res.status(400).json({ error: 'bad_json' });
        next(err);
    });

    return router;
}
