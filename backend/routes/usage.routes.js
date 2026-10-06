import express from 'express';
import rateLimit from 'express-rate-limit';
import { supabase as defaultSupabase } from '../config/database.js';
import { verifiedUserId } from '../lib/verifiedUser.js';
import { appSubdomains } from '../lib/appSubdomains.js';
import { mergeUsageReports } from '../lib/usageMerge.js';

// What a generated app uses, for its creator:
//   GET /api/projects/:id/usage?days=7     (1..30, default 7)
// Identity comes ONLY from the caller's verified Supabase access token (lib/verifiedUser.js) and must be the project's creator,
// the same rule as the secrets routes. The project's preview and published subdomain apps are looked up in the platform proxy and
// merged (lib/usageMerge.js). The answer is numbers only: per-day and total counts per feature, the caps, and current usage.
const PROJECT_ID = /^[A-Za-z0-9-]{8,64}$/;

export function createUsageRouter({ supabase = defaultSupabase, verifyUser = verifiedUserId, proxyAdmin, log = console.error, maxPerMinute = 30, baseDomain = process.env.BASE_DOMAIN || 'vibebuild.cc' }) {
    const router = express.Router({ mergeParams: true });
    router.use(rateLimit({ windowMs: 60_000, limit: maxPerMinute, standardHeaders: false, legacyHeaders: false, message: { error: 'rate_limited' } }));
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    router.get('/', async (req, res) => {
        const uid = await verifyUser(req);
        if (!uid) return res.status(401).json({ error: 'unauthorized' });
        if (!proxyAdmin?.configured) return res.status(503).json({ error: 'usage_unavailable' });
        const id = req.params.id;
        if (!PROJECT_ID.test(id)) return res.status(404).json({ error: 'not_found' });
        const raw = req.query.days;
        const days = raw === undefined ? 7 : typeof raw === 'string' && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isInteger(days) || days < 1 || days > 30) return res.status(400).json({ error: 'invalid_days' });
        const { data: project, error } = await supabase.from('projects').select('id, creator_id, preview_url, published_url').eq('id', id).single();
        if (error || !project) return res.status(404).json({ error: 'not_found' });
        if (project.creator_id !== uid) return res.status(403).json({ error: 'forbidden' });
        try {
            const reports = [];
            for (const sub of appSubdomains(project, baseDomain)) {
                try { reports.push(await proxyAdmin.getUsage(sub, days)); } catch (e) { if (e?.code !== 'unknown_app') throw e; } // an app that never ran has no usage yet
            }
            res.json(mergeUsageReports(reports));
        } catch (e) {
            log(`[usage] read failed project=${id} code=${e?.code || 'error'}`);
            res.status(502).json({ error: 'usage_unavailable' });
        }
    });

    return router;
}
