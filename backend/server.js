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
import { errorHandler } from './middleware/errorHandler.js';
import { WORKER_URL } from './config/constants.js';

const app = express();
app.set('trust proxy', 1);
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

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`VibeCoder backend running on http://localhost:${PORT}`);
});
