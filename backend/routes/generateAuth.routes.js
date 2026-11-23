// GET /api/generate-auth/stats - counters from lib/generateAuth.js, worker secret required (same pattern as /api/telegram/stats).
import express from 'express';
import crypto from 'node:crypto';
import { WORKER_SECRET } from '../config/constants.js';
import { generateAuthStats, generateAuthMode } from '../lib/generateAuth.js';

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && b.length > 0 && crypto.timingSafeEqual(digest(a), digest(b));

export function createGenerateAuthRouter({ workerSecret = WORKER_SECRET, stats = generateAuthStats, env = process.env } = {}) {
    const router = express.Router();
    router.get('/stats', (req, res) => {
        if (!safeEqual(String(req.headers['x-worker-secret'] || ''), workerSecret)) return res.status(401).json({ error: 'Unauthorized' });
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, mode: generateAuthMode(env), scope: 'this machine, since its last restart', ...stats.snapshot() });
    });
    return router;
}

export default createGenerateAuthRouter();
