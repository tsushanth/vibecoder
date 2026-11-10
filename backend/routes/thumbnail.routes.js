import express from 'express';
import rateLimit from 'express-rate-limit';
import { supabase as defaultSupabase } from '../config/database.js';
import { createThumbnailService, neutralPlaceholderPng, thumbnailLabel } from '../lib/thumbnailService.js';

// GET /api/projects/:id/thumbnail[?miss=404]
// The app's thumbnail over this API's own https origin. The stored thumbnail_url points at a plain-http screenshot service, which
// an https page cannot show and which falls over under a page's worth of concurrent requests. The page that gets rendered is
// derived from the project row (its preview host, allow-listed to *.BASE_DOMAIN), never from the request. A failed or slow render
// returns a neutral placeholder image, or a 404 with ?miss=404 for clients that draw their own fallback.
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_CACHE = 'public, max-age=86400, stale-while-revalidate=86400';

export function createThumbnailRouter({
    supabase = defaultSupabase,
    service = createThumbnailService({ log: console.error }),
    baseDomain = process.env.BASE_DOMAIN || 'vibebuild.cc',
    maxPerMinute = 600,
    labelTtlMs = 10 * 60_000,
    now = () => Date.now(),
} = {}) {
    const router = express.Router({ mergeParams: true });
    const placeholder = neutralPlaceholderPng();
    const placeholderEtag = '"placeholder-1"';
    const labels = new Map(); // project id -> {label|null, until}; keeps the database out of the hot path
    router.use(rateLimit({ windowMs: 60_000, limit: maxPerMinute, standardHeaders: false, legacyHeaders: false, message: { error: 'rate_limited' } }));

    const common = (res) => res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin' });
    const missing = (res, ttl = 60) => res.status(404).set('Cache-Control', `public, max-age=${ttl}`).json({ error: 'not_found' });

    async function labelFor(id) {
        const hit = labels.get(id);
        if (hit && hit.until > now()) return hit.label;
        const { data, error } = await supabase.from('projects').select('id, preview_url, thumbnail_url').eq('id', id).single();
        if (error && error.code !== 'PGRST116') throw error;
        const label = data ? thumbnailLabel(data, baseDomain) : null;
        labels.delete(id); labels.set(id, { label, until: now() + labelTtlMs });
        while (labels.size > 5000) labels.delete(labels.keys().next().value);
        return label;
    }

    router.get('/', async (req, res) => {
        const id = req.params.id;
        if (!UUID_ID.test(id)) return missing(res);
        const clientFallback = req.query.miss === '404';
        try {
            const label = await labelFor(id.toLowerCase());
            if (!label) return missing(res);
            const { state, entry } = await service.get(label);
            common(res);
            if (entry) {
                res.set({ ETag: entry.etag, 'Cache-Control': IMAGE_CACHE, 'X-Thumbnail': state });
                if (req.get('if-none-match') === entry.etag) return res.status(304).end();
                return res.status(200).type(entry.type).send(entry.body);
            }
            res.set({ 'Cache-Control': 'public, max-age=30', 'X-Thumbnail': 'unavailable' });
            if (clientFallback) return res.status(404).json({ error: 'thumbnail_unavailable' });
            return res.status(200).set('ETag', placeholderEtag).type('image/png').send(placeholder);
        } catch (e) {
            console.error(`[thumbnail] lookup failed project=${id} ${e?.code || e?.message || 'error'}`);
            res.set('Cache-Control', 'no-store');
            if (clientFallback) return res.status(503).json({ error: 'thumbnail_unavailable' });
            return common(res).status(200).type('image/png').send(placeholder);
        }
    });

    return router;
}
