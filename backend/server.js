// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import subscriptionsRoutes from './routes/subscriptions.routes.js';
import projectsRoutes from './routes/projects.routes.js';
import authRoutes from './routes/auth.routes.js';
import deployRoutes from './routes/deploy.routes.js';
import domainsRoutes from './routes/domains.routes.js';
import telegramRoutes from './routes/telegram.routes.js';
import { reportCrash } from './lib/failureReporter.js';
import githubRoutes from './routes/github.routes.js';
import appdataRoutes from './routes/appdata.routes.js';
import { createSecretsRouter } from './routes/secrets.routes.js';
import { createUsageRouter } from './routes/usage.routes.js';
import { createSchemaPlanRouter } from './routes/schemaPlan.routes.js';
import { createProxyAdmin } from './services/proxyAdmin.js';
import { errorHandler } from './middleware/errorHandler.js';
import { WORKER_URL, WORKER_SECRET } from './config/constants.js';

const app = express();
app.set('trust proxy', 1);
// Mounted BEFORE global cors(): appdata does its own per-app CORS (generated-app origins).
app.use('/api/appdata', appdataRoutes);
// Key entry for generated apps. Mounted BEFORE the global json parser (50 MB) so its own 8 KB limit applies, and with its own CORS
// (the VibeBuild web origins only). Identity is the verified Supabase token, never a client-supplied userId. Returns 503 until
// PROXY_ADMIN_URL (https) and PROXY_ADMIN_TOKEN (32+ characters) are set.
const WEB_ORIGINS = ['https://vibebuild.cc', 'https://www.vibebuild.cc', 'https://vibebuild-web.fly.dev', 'http://localhost:3000'];
const proxyAdmin = createProxyAdmin({ baseUrl: process.env.PROXY_ADMIN_URL, token: process.env.PROXY_ADMIN_TOKEN });
app.use('/api/projects/:id/secrets', cors({ origin: WEB_ORIGINS }), createSecretsRouter({ proxyAdmin }));
app.use('/api/projects/:id/usage', cors({ origin: WEB_ORIGINS }), createUsageRouter({ proxyAdmin }));
app.use('/api/projects/:id/schema', cors({ origin: WEB_ORIGINS }), createSchemaPlanRouter({ proxyAdmin }));
app.locals.proxyAdmin = proxyAdmin; // used by the deploy routes to register deployed apps with the proxy
app.use(cors({
    origin: [
        'https://vibebuild.cc',
        'https://www.vibebuild.cc',
        'https://vibebuild-web.fly.dev',
        'https://vibebuild-web.fly.dev',
        'http://localhost:3000',
    ],
    credentials: true,
}));
// Skip JSON parsing for Stripe webhook (needs raw body for signature verification)
app.use((req, res, next) => {
    if (req.originalUrl === '/api/subscriptions/stripe-webhook') {
        next();
    } else {
        express.json({ limit: '50mb' })(req, res, next);
    }
});

// Health
app.get('/api/health', (req, res) => {
    res.json({ healthy: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Deep health: can a build actually run? Checks the build worker and, through it, that the Claude broker has a usable
// login. /api/health only proves this API is up, which stayed green through a multi-day outage where every build failed.
// Probed every few minutes by the failure reporter, which emails when this stays non-200.
app.get('/api/health/deep', async (req, res) => {
    const fail = (reason, extra = {}) => res.status(503).json({ ready: false, reason, ...extra });
    let r;
    try {
        r = await fetch(`${WORKER_URL}/ready`, { headers: { 'x-worker-secret': WORKER_SECRET }, signal: AbortSignal.timeout(10000) });
    } catch {
        return fail('build worker unreachable');
    }
    let body = null;
    try { body = await r.json(); } catch { /* non-JSON body */ }
    if (r.ok && body?.ready) return res.json({ ready: true, mode: body.mode });
    return fail(body?.reason || `build worker returned ${r.status}`, { status: r.status });
});

// System status — mobile apps poll this to show maintenance banners
app.get('/api/status', async (req, res) => {
    try {
        const workerRes = await fetch(`${WORKER_URL}/health`, {
            signal: AbortSignal.timeout(5000)
        }).catch(() => null);

        let workerData = null;
        if (workerRes?.ok) workerData = await workerRes.json().catch(() => null);

        const quotaExhausted = workerData?.quotaExhausted ?? false;
        const activeBuildCount = workerData?.activeBuildCount ?? 0;

        if (quotaExhausted) {
            return res.json({
                operational: false,
                message: "We're at capacity right now. Your builds will be available soon — check back in a few hours!",
                estimatedReady: null
            });
        }

        res.json({ operational: true, message: null, activeBuildCount });
    } catch {
        res.json({ operational: true, message: null });
    }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/domains', domainsRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/github', githubRoutes);

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 8080;
// Process-level failures: log, report (awaited so the email goes out), then exit like Node's default.
for (const evt of ['uncaughtException', 'unhandledRejection']) {
    process.on(evt, (err) => {
        console.error(evt, err);
        reportCrash(evt, err).finally(() => process.exit(1));
    });
}

app.listen(PORT, () => {
    console.log(`VibeCoder backend running on http://localhost:${PORT}`);
});
