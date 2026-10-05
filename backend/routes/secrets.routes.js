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
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

// The apps that actually run a project are its preview and published subdomains; the SDK identifies an app by subdomain.
// A key set here is therefore stored under the project id (the canonical copy that new deployments are seeded from) and under
// each of those subdomains. Only single-label names under our own base domain count; anything else in those columns is ignored.
function appSubdomains(project, baseDomain) {
    const out = [];
    for (const u of [project.preview_url, project.published_url]) {
        let host;
        try { host = new URL(u).hostname.toLowerCase(); } catch { continue; }
        if (!host.endsWith(`.${baseDomain}`)) continue;
        const label = host.slice(0, -(baseDomain.length + 1));
        if (SUBDOMAIN.test(label) && !out.includes(label)) out.push(label);
    }
    return out;
}

// An app that sells things (its manifest has a pay catalog) runs on the creator's own Stripe account: the proxy needs their secret
// key and the signing secret of the webhook they register in Stripe (platform/pay/service.js reads these two vault names).
const PAY_SECRETS = [
    { name: 'STRIPE_SECRET_KEY', purpose: 'Your Stripe secret key: starts with sk_ or rk_ (test keys start with sk_test_)' },
    { name: 'STRIPE_WEBHOOK_SECRET', purpose: 'The signing secret of your Stripe webhook endpoint: starts with whsec_' },
];
const hasPay = (app) => Number.isInteger(app?.pay?.items) && app.pay.items > 0;

// The secrets an app's manifest asks for, one entry per secret name with the connectors that use it, then the Stripe keys when
// the app sells things (connector 'pay', with a short `purpose` hint). Names and hints only.
function requiredFrom(app) {
    const byName = new Map();
    for (const c of Array.isArray(app?.connectors) ? app.connectors : []) {
        if (!c || typeof c.name !== 'string' || !c.secret || !SECRET_NAME.test(String(c.secret.name || ''))) continue;
        byName.set(c.secret.name, [...(byName.get(c.secret.name) || []), c.name]);
    }
    const purposes = new Map();
    if (hasPay(app)) for (const { name, purpose } of PAY_SECRETS) { byName.set(name, [...(byName.get(name) || []), 'pay']); purposes.set(name, purpose); }
    return [...byName].map(([name, connectors]) => ({ name, connectors, ...(purposes.has(name) ? { purpose: purposes.get(name) } : {}) }));
}

// Where the creator registers the Stripe webhook: the proxy serves /<app>/pay/webhook for the app the browser calls, which is the
// published subdomain, or the preview one until the app is published (appSubdomains lists the preview first, the published last).
// Null when the project has no app of its own yet.
function payWebhookUrl(subdomains, proxyPublicUrl) {
    const sub = subdomains.at(-1);
    return sub ? `${String(proxyPublicUrl).replace(/\/+$/, '')}/${sub}/pay/webhook` : null;
}

export function createSecretsRouter({ supabase = defaultSupabase, verifyUser = verifiedUserId, proxyAdmin, log = console.error, maxPerMinute = 60, baseDomain = process.env.BASE_DOMAIN || 'vibebuild.cc', proxyPublicUrl = process.env.PROXY_PUBLIC_URL || 'https://vibe-proxy.vibebuild.cc' }) {
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
        const { data: project, error } = await supabase.from('projects').select('id, creator_id, preview_url, published_url').eq('id', id).single();
        if (error || !project) return res.status(404).json({ error: 'not_found' });
        if (project.creator_id !== uid) return res.status(403).json({ error: 'forbidden' });
        req.projectId = id;
        req.appSubdomains = appSubdomains(project, baseDomain);
        next();
    });

    router.use(express.json({ limit: '8kb' }));

    router.get('/', async (req, res) => {
        try {
            const [secrets, app] = await Promise.all([
                proxyAdmin.listSecrets(req.projectId).catch((e) => { if (e?.code === 'unknown_app') return []; throw e; }),
                proxyAdmin.getApp(req.projectId).catch((e) => { if (e?.code === 'unknown_app') return null; throw e; }),
            ]);
            res.json({ secrets, required: requiredFrom(app), ...(hasPay(app) ? { pay: { webhookUrl: payWebhookUrl(req.appSubdomains, proxyPublicUrl) } } : {}) });
        } catch (e) {
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
                // the project-id app only holds the manifest and the canonical keys; it is never enabled for calls
                await proxyAdmin.registerApp(req.projectId, { manifest: null, domains: [], enabled: false });
                await proxyAdmin.setSecret(req.projectId, name, value);
            }
            for (const sub of req.appSubdomains) {
                try { await proxyAdmin.setSecret(sub, name, value); } catch (e) { if (e?.code !== 'unknown_app') throw e; }
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
            for (const appId of [req.projectId, ...req.appSubdomains]) {
                try { await proxyAdmin.deleteSecret(appId, name); } catch (e) { if (e?.code !== 'unknown_app') throw e; }
            }
        } catch (e) {
            return fail(res, 'delete', req.projectId, e);
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
