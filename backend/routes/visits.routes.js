// GET /api/visits -> the signed-in creator's published apps with their visit counts.
//   { success, countingSince, apps: [{ projectId, url, openUrl, today, last7Days, last30Days, total }] }
// Counts come from table vibebuild_app_visits, written by the deploy server: people loading the published page in a browser,
// without bots, the creator's own browser (see openUrl) or views inside the VibeBuild app. Days are UTC. No visitor data exists.
// Identity is the verified access token only.
import express from 'express';
import { supabase as defaultClient } from '../config/database.js';
import { verifiedUserId } from '../lib/verifiedUser.js';
import { ownerUrl } from '../lib/ownerVisit.js';
import { requireSecret } from '../lib/requireSecret.js';
import { reportFailure } from '../lib/failureReporter.js';

export const COUNTING_SINCE = '2026-11-26';

export function createVisitsRouter({ verifyUser = verifiedUserId, client = defaultClient, secret = requireSecret('INTERNAL_SECRET'), baseDomain = process.env.BASE_DOMAIN || 'vibebuild.cc', now = () => Date.now(), report = reportFailure } = {}) {
    const router = express.Router();
    router.get('/', async (req, res) => {
        try {
            const userId = await verifyUser(req);
            if (!userId) return res.status(401).json({ error: 'Sign in again.' });
            const { data, error } = await client.rpc('vibebuild_creator_visits', { p_user: userId });
            if (error) {
                report('visits:read', new Error('creator visit counts could not be read'), { code: String(error.code || 'none').slice(0, 20) });
                return res.status(503).json({ error: 'Visit counts are not available right now.' });
            }
            const apps = (data || []).filter((r) => r.subdomain).map((r) => {
                const url = `https://${r.subdomain}.${baseDomain}`;
                return {
                    projectId: r.project_id,
                    url,
                    openUrl: ownerUrl(secret, url, r.subdomain, now()),
                    today: Number(r.today) || 0,
                    last7Days: Number(r.last_7_days) || 0,
                    last30Days: Number(r.last_30_days) || 0,
                    total: Number(r.total) || 0,
                };
            });
            res.set('Cache-Control', 'private, no-store');
            res.json({ success: true, countingSince: COUNTING_SINCE, apps });
        } catch (e) {
            report('visits:read', new Error('creator visit counts could not be read'), { error_name: String(e?.name || 'none') });
            res.status(503).json({ error: 'Visit counts are not available right now.' });
        }
    });
    return router;
}

export default createVisitsRouter();
