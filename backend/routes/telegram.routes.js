import express from 'express';
import crypto from 'crypto';
import { supabase as defaultSupabase } from '../config/database.js';
import { WORKER_SECRET } from '../config/constants.js';
import { createWindowLimiter } from '../lib/rateWindow.js';

const TEN_MIN = 10 * 60 * 1000;
const DEFAULT_LIMITS = {
    verifyFailPerIp: 10,        // wrong or expired codes per address per 10 minutes
    verifyFailGlobal: 600,      // wrong or expired codes across all addresses per 10 minutes
    mintPerUser: 5,             // codes minted for one user per 10 minutes
    mintPerIp: 20,              // codes minted from one address per 10 minutes
    lookupPerMin: 60,           // telegram-id lookups per address per minute
    maxOutstandingCodes: 10_000,
};
const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();

export function createTelegramRouter({ supabase = defaultSupabase, workerSecret = '', now = () => Date.now(), limits = {} } = {}) {
    const lim = { ...DEFAULT_LIMITS, ...limits };
    const router = express.Router();

    // In-memory store for magic link codes (code -> { userId, expiresAt }); per process, cleared on restart
    const magicLinks = new Map();
    const sweepExpired = () => { const t = now(); for (const [code, data] of magicLinks) if (t > data.expiresAt) magicLinks.delete(code); };

    const failIp = createWindowLimiter({ windowMs: TEN_MIN, max: lim.verifyFailPerIp, now });
    const failGlobal = createWindowLimiter({ windowMs: TEN_MIN, max: lim.verifyFailGlobal, maxKeys: 1, now });
    const mintUser = createWindowLimiter({ windowMs: TEN_MIN, max: lim.mintPerUser, now });
    const mintIp = createWindowLimiter({ windowMs: TEN_MIN, max: lim.mintPerIp, now });
    const lookupIp = createWindowLimiter({ windowMs: 60_000, max: lim.lookupPerMin, now });

    const tooMany = (res, ms) => { res.set('Retry-After', String(Math.max(1, Math.ceil(ms / 1000)))); return res.status(429).json({ error: 'Too many attempts, try again later' }); };

    /** Returns a response-sending result if minting must be refused, else null (and records the mint). */
    function refuseMint(req, res, userId) {
        sweepExpired();
        if (magicLinks.size >= lim.maxOutstandingCodes) return res.status(503).json({ error: 'busy' });
        if (mintUser.count(userId) >= lim.mintPerUser || mintIp.count(req.ip) >= lim.mintPerIp) {
            return tooMany(res, Math.max(mintUser.retryAfterMs(userId), mintIp.retryAfterMs(req.ip), 1000));
        }
        mintUser.hit(userId); mintIp.hit(req.ip);
        return null;
    }

    // GET /api/telegram/connect?tg_id=X - Called by web app after user signs in
    // Generates a code that links a Telegram user to a VibeBuild account
    router.get('/connect', async (req, res) => {
        try {
            const { tg_id, user_id } = req.query;
            if (!tg_id || !user_id) return res.status(400).json({ error: 'tg_id and user_id are required' });
            if (refuseMint(req, res, String(user_id))) return;

            const code = crypto.randomBytes(3).toString('hex').toUpperCase();
            magicLinks.set(code, {
                userId: user_id,
                expiresAt: now() + TEN_MIN,
            });

            res.json({ success: true, code, expiresIn: 600 });
        } catch (error) {
            console.error('[telegram/connect] Error:', error.message);
            res.status(500).json({ error: 'Failed to generate connect code' });
        }
    });

    // POST /api/telegram/link - Generate magic link code for a VibeBuild user
    // Called from the app when user taps "Connect Telegram"
    router.post('/link', async (req, res) => {
        try {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId is required' });
            if (refuseMint(req, res, String(userId))) return;

            // Generate a 6-char code
            const code = crypto.randomBytes(3).toString('hex').toUpperCase();
            magicLinks.set(code, {
                userId,
                expiresAt: now() + TEN_MIN, // 10 min expiry
            });

            res.json({
                success: true,
                code,
                botUrl: `https://t.me/Vibebuilder_bot?start=link_${code}`,
                expiresIn: 600,
            });
        } catch (error) {
            console.error('[telegram/link] Error:', error.message);
            res.status(500).json({ error: 'Failed to generate link code' });
        }
    });

    // POST /api/telegram/verify - Verify magic link code (called by the bot)
    router.post('/verify', async (req, res) => {
        try {
            const { code, telegramId, telegramUsername, telegramName } = req.body;
            if (!code || !telegramId) {
                return res.status(400).json({ error: 'code and telegramId are required' });
            }

            if (failIp.count(req.ip) >= lim.verifyFailPerIp) return tooMany(res, failIp.retryAfterMs(req.ip));
            if (failGlobal.count('all') >= lim.verifyFailGlobal) return tooMany(res, failGlobal.retryAfterMs('all'));

            const key = String(code).toUpperCase();
            const linkData = magicLinks.get(key);
            if (!linkData) {
                failIp.hit(req.ip); failGlobal.hit('all');
                return res.status(404).json({ error: 'Invalid or expired code' });
            }
            if (now() > linkData.expiresAt) {
                magicLinks.delete(key);
                failIp.hit(req.ip); failGlobal.hit('all');
                return res.status(410).json({ error: 'Code has expired' });
            }

            const userId = linkData.userId;
            magicLinks.delete(key);

            // Store telegram link in users table
            const { error } = await supabase
                .from('users')
                .update({
                    telegram_id: String(telegramId),
                    telegram_username: telegramUsername || null,
                    updated_at: new Date().toISOString(),
                })
                .eq('user_id', userId);

            if (error) {
                console.warn('[telegram/verify] DB update error:', error.message);
                // Column may not exist yet — still return success with userId
            }

            // Get user info
            const { data: user } = await supabase
                .from('users')
                .select('user_id, display_name, email, subscription_tier')
                .eq('user_id', userId)
                .single();

            res.json({
                success: true,
                userId,
                displayName: user?.display_name || 'Builder',
                subscriptionTier: user?.subscription_tier || 'free',
            });
        } catch (error) {
            console.error('[telegram/verify] Error:', error.message);
            res.status(500).json({ error: 'Failed to verify code' });
        }
    });

    // GET /api/telegram/user/:telegramId - Look up user by Telegram ID
    router.get('/user/:telegramId', async (req, res) => {
        try {
            if (!lookupIp.hit(req.ip)) return tooMany(res, lookupIp.retryAfterMs(req.ip));
            const { telegramId } = req.params;

            const { data: user, error } = await supabase
                .from('users')
                .select('user_id, display_name, email, subscription_tier, total_projects')
                .eq('telegram_id', String(telegramId))
                .single();

            if (error || !user) {
                return res.json({ linked: false });
            }

            // Get their recent projects
            const { data: projects } = await supabase
                .from('projects')
                .select('id, title, status, created_at, published_url, preview_url')
                .eq('creator_id', user.user_id)
                .order('created_at', { ascending: false })
                .limit(5);

            res.json({
                linked: true,
                userId: user.user_id,
                displayName: user.display_name,
                subscriptionTier: user.subscription_tier || 'free',
                totalProjects: user.total_projects || 0,
                recentProjects: projects || [],
            });
        } catch (error) {
            console.error('[telegram/user] Error:', error.message);
            res.json({ linked: false });
        }
    });

    // POST /api/telegram/notify - Send notification to a user's Telegram (called by backend/build-monitor)
    router.post('/notify', async (req, res) => {
        const sent = req.headers['x-worker-secret'];
        if (!workerSecret || typeof sent !== 'string' || !crypto.timingSafeEqual(digest(sent), digest(workerSecret))) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        try {
            const { userId, message, type } = req.body;
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (!botToken) return res.status(503).json({ error: 'Telegram bot not configured' });

            // Look up telegram_id from userId
            const { data: user } = await supabase
                .from('users')
                .select('telegram_id')
                .eq('user_id', userId)
                .single();

            if (!user?.telegram_id) {
                return res.json({ success: false, reason: 'User has no linked Telegram' });
            }

            // Send message via Telegram API
            const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: user.telegram_id,
                    text: message,
                    parse_mode: 'Markdown',
                }),
            });

            const tgData = await tgRes.json();
            res.json({ success: tgData.ok });
        } catch (error) {
            console.error('[telegram/notify] Error:', error.message);
            res.status(500).json({ error: 'Failed to send notification' });
        }
    });

    return router;
}

export default createTelegramRouter({ workerSecret: WORKER_SECRET });
