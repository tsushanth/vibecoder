import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/database.js';

// Per-app key-value store for generated static apps.
//   GET    /api/appdata/:appId/:collection            list (?prefix=&limit=&after=)
//   GET    /api/appdata/:appId/:collection/:key       get
//   PUT    /api/appdata/:appId/:collection/:key       body {"value": <json>}
//   DELETE /api/appdata/:appId/:collection/:key
// appId = the deployment subdomain. Requests must come (Origin header) from that app's
// own published origin. NOTE: Origin is enforced by browsers, not by curl - it stops other
// websites from using an app's data, not a determined script. Quotas/rate limits are the real defence.

export const BASE_DOMAIN = process.env.BASE_DOMAIN || 'vibebuild.cc';
export const LIMITS = {
    maxKeysPerApp: 1000,
    maxValueBytes: 32 * 1024,
    maxTotalBytes: 5 * 1024 * 1024,
    maxCollectionsPerApp: 50,
    listMax: 100,
    listDefault: 50,
    writesPerMinPerIpApp: 60,
    readsPerMinPerIpApp: 300,
    writesPerMinPerApp: 1200,
};
let SDK_SOURCE = '';
try { SDK_SOURCE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/vibedata.js'), 'utf8'); }
catch { SDK_SOURCE = '/* vibedata sdk unavailable */'; }
const BODY_LIMIT = '40kb';

const APP_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;
const COLL_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export const validAppId = (s) => typeof s === 'string' && APP_RE.test(s);
export const validCollection = (s) => typeof s === 'string' && COLL_RE.test(s);
export const validKey = (s) => typeof s === 'string' && KEY_RE.test(s) && s !== '.' && s !== '..';

/** Returns {ok, json, size} or {ok:false, error}. */
export function validateValue(value) {
    if (value === undefined) return { ok: false, error: 'body must be {"value": <json>}' };
    let json;
    try { json = JSON.stringify(value); } catch { return { ok: false, error: 'value not serialisable' }; }
    const size = Buffer.byteLength(json, 'utf8');
    if (size > LIMITS.maxValueBytes) return { ok: false, error: `value exceeds ${LIMITS.maxValueBytes} bytes`, status: 413 };
    return { ok: true, size };
}

// ---- rate limiting (in-memory fixed window; per-instance, resets on deploy) ----
export function createRateLimiter() {
    const buckets = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
    }, 60_000);
    timer.unref?.();
    return function hit(key, max, windowMs = 60_000) {
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || b.reset <= now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
        b.n++;
        return b.n <= max ? 0 : Math.ceil((b.reset - now) / 1000); // 0 = allowed, else retry-after secs
    };
}

const MISSING_CODES = new Set(['PGRST205', 'PGRST202', '42P01', '42883']);
const isMissing = (err) => err && (MISSING_CODES.has(err.code) || /schema cache|does not exist/i.test(err.message || ''));

// ---- Supabase store ----
export function createSupabaseStore(db = supabase) {
    return {
        async get(app, coll, key) {
            const { data, error } = await db.from('app_data').select('value,updated_at')
                .eq('app_id', app).eq('collection', coll).eq('key', key).maybeSingle();
            if (error) throw error;
            return data ? { value: data.value, updatedAt: data.updated_at } : null;
        },
        async put(app, coll, key, value, size) {
            const { data, error } = await db.rpc('app_data_put', {
                p_app: app, p_collection: coll, p_key: key, p_value: value, p_size: size,
                p_max_keys: LIMITS.maxKeysPerApp, p_max_total: LIMITS.maxTotalBytes,
            });
            if (error) throw error;
            return data; // 'ok' | 'max_keys' | 'max_total' | 'max_collections'
        },
        async remove(app, coll, key) {
            const { error } = await db.from('app_data').delete()
                .eq('app_id', app).eq('collection', coll).eq('key', key);
            if (error) throw error;
        },
        async list(app, coll, { prefix, limit, after }) {
            let q = db.from('app_data').select('key,value,updated_at')
                .eq('app_id', app).eq('collection', coll).order('key', { ascending: true }).limit(limit + 1);
            if (prefix) q = q.gte('key', prefix).lt('key', prefix + '￿');
            if (after) q = q.gt('key', after);
            const { data, error } = await q;
            if (error) throw error;
            return data.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
        },
        async collectionExists(app, coll) {
            const { data, error } = await db.from('app_data').select('key').eq('app_id', app).eq('collection', coll).limit(1);
            if (error) throw error;
            return data.length > 0;
        },
        async collectionCount(app) {
            // Bounded: at most maxKeysPerApp rows per app.
            const { data, error } = await db.from('app_data').select('collection').eq('app_id', app).limit(LIMITS.maxKeysPerApp);
            if (error) throw error;
            return new Set(data.map((r) => r.collection)).size;
        },
    };
}

// ---- allowed origins per app (deployments + verified custom domains), cached ----
export function createSupabaseOriginResolver(db = supabase, ttlMs = 60_000) {
    const cache = new Map();
    return async function allowedOrigins(appId) {
        const hit = cache.get(appId);
        if (hit && hit.exp > Date.now()) return hit.origins;
        const { data: dep, error } = await db.from('deployments').select('id,status').eq('subdomain', appId).maybeSingle();
        if (error) throw error;
        let origins = null; // null = unknown app
        if (dep && dep.status === 'active') {
            origins = new Set([`https://${appId}.${BASE_DOMAIN}`]);
            const { data: doms, error: e2 } = await db.from('custom_domains').select('domain')
                .eq('deployment_id', dep.id).eq('verification_status', 'active');
            // custom_domains may not exist in every environment; then only the default origin applies.
            if (e2 && !isMissing(e2)) throw e2;
            for (const d of doms || []) origins.add(`https://${String(d.domain).toLowerCase()}`);
        }
        cache.set(appId, { origins, exp: Date.now() + ttlMs });
        if (cache.size > 5000) cache.clear();
        return origins;
    };
}

export function createAppDataRouter({ store, allowedOrigins, rateLimit = createRateLimiter() } = {}) {
    const router = express.Router();

    // SDK script (cross-origin <script> needs no CORS). 'sdk.js' can never be a valid app id.
    router.get('/sdk.js', (_req, res) => {
        res.type('application/javascript').set('Cache-Control', 'public, max-age=300').send(SDK_SOURCE);
    });

    const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });
    const handleErr = (res, err, what) => {
        if (isMissing(err)) return fail(res, 503, 'App data storage is not available yet');
        console.error(`[appdata] ${what} error:`, err?.message || err);
        return fail(res, 500, 'App data error');
    };

    // 1. Validate ids, resolve app, enforce origin, CORS.
    router.use('/:appId', async (req, res, next) => {
        const { appId } = req.params;
        if (!validAppId(appId)) return fail(res, 400, 'invalid app id');
        const origin = req.headers.origin;
        try {
            const origins = await allowedOrigins(appId);
            if (!origins) return fail(res, 404, 'unknown app');
            if (!origin || !origins.has(origin.toLowerCase())) return fail(res, 403, 'origin not allowed for this app');
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Access-Control-Max-Age', '600');
            if (req.method === 'OPTIONS') return res.status(204).end();
            next();
        } catch (err) { return handleErr(res, err, 'origin lookup'); }
    });

    // 2. Rate limit (reads/writes separately) + global per-app write cap.
    router.use('/:appId', (req, res, next) => {
        const write = req.method !== 'GET';
        const ip = req.ip || 'unknown';
        let wait = rateLimit(`${write ? 'w' : 'r'}:${ip}:${req.params.appId}`,
            write ? LIMITS.writesPerMinPerIpApp : LIMITS.readsPerMinPerIpApp);
        if (!wait && write) wait = rateLimit(`wa:${req.params.appId}`, LIMITS.writesPerMinPerApp);
        if (wait) { res.setHeader('Retry-After', String(wait)); return fail(res, 429, 'rate limited'); }
        next();
    });

    // 3. JSON only, small body.
    router.use('/:appId', (req, res, next) => {
        if (req.method !== 'PUT') return next();
        if (!req.is('application/json')) return fail(res, 415, 'Content-Type must be application/json');
        express.json({ limit: BODY_LIMIT, strict: true })(req, res, (err) => {
            if (err) return fail(res, err.type === 'entity.too.large' ? 413 : 400, err.type === 'entity.too.large' ? 'body too large' : 'invalid JSON');
            next();
        });
    });

    router.get('/:appId/:collection', async (req, res) => {
        const { appId, collection } = req.params;
        if (!validCollection(collection)) return fail(res, 400, 'invalid collection');
        const prefix = req.query.prefix === undefined ? '' : String(req.query.prefix);
        const after = req.query.after === undefined ? '' : String(req.query.after);
        if ((prefix && !/^[A-Za-z0-9._:-]{1,128}$/.test(prefix)) || (after && !validKey(after))) return fail(res, 400, 'invalid prefix/after');
        let limit = parseInt(req.query.limit ?? LIMITS.listDefault, 10);
        if (!Number.isFinite(limit) || limit < 1) limit = LIMITS.listDefault;
        limit = Math.min(limit, LIMITS.listMax);
        try {
            const rows = await store.list(appId, collection, { prefix, limit, after });
            const more = rows.length > limit;
            const items = rows.slice(0, limit);
            res.json({ items, next: more ? items[items.length - 1].key : null });
        } catch (err) { handleErr(res, err, 'list'); }
    });

    router.get('/:appId/:collection/:key', async (req, res) => {
        const { appId, collection, key } = req.params;
        if (!validCollection(collection) || !validKey(key)) return fail(res, 400, 'invalid collection or key');
        try {
            const row = await store.get(appId, collection, key);
            if (!row) return fail(res, 404, 'not found');
            res.json({ key, value: row.value, updatedAt: row.updatedAt });
        } catch (err) { handleErr(res, err, 'get'); }
    });

    router.put('/:appId/:collection/:key', async (req, res) => {
        const { appId, collection, key } = req.params;
        if (!validCollection(collection) || !validKey(key)) return fail(res, 400, 'invalid collection or key');
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body) || !('value' in body)) return fail(res, 400, 'body must be {"value": <json>}');
        const v = validateValue(body.value);
        if (!v.ok) return fail(res, v.status || 400, v.error);
        try {
            // New collection? enforce collection cap (best-effort; keys/bytes caps are atomic in DB).
            if (!(await store.collectionExists(appId, collection)) && (await store.collectionCount(appId)) >= LIMITS.maxCollectionsPerApp)
                return fail(res, 413, `max ${LIMITS.maxCollectionsPerApp} collections per app`);
            const result = await store.put(appId, collection, key, body.value, v.size);
            if (result === 'max_keys') return fail(res, 413, `app key quota reached (${LIMITS.maxKeysPerApp})`);
            if (result === 'max_total') return fail(res, 413, `app storage quota reached (${LIMITS.maxTotalBytes} bytes)`);
            if (result !== 'ok') return fail(res, 500, 'App data error');
            res.json({ ok: true, key });
        } catch (err) { handleErr(res, err, 'put'); }
    });

    router.delete('/:appId/:collection/:key', async (req, res) => {
        const { appId, collection, key } = req.params;
        if (!validCollection(collection) || !validKey(key)) return fail(res, 400, 'invalid collection or key');
        try { await store.remove(appId, collection, key); res.json({ ok: true }); }
        catch (err) { handleErr(res, err, 'delete'); }
    });

    return router;
}

export default createAppDataRouter({
    store: createSupabaseStore(),
    allowedOrigins: createSupabaseOriginResolver(),
});
