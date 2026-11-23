import express from 'express';
import crypto from 'crypto';
import { supabase as defaultSupabase } from '../config/database.js';
import { WORKER_SECRET } from '../config/constants.js';
import { createWindowLimiter } from '../lib/rateWindow.js';
import { createLinkService } from '../lib/telegramLink.js';
import { verifiedUserId } from '../lib/verifiedUser.js';
import { channelEvents } from '../lib/channelEventsInstance.js';
import { createTelegramApi } from '../lib/telegram/api.js';
import { createBot } from '../lib/telegram/bot.js';
import { createLoopbackBuilds, createLoopbackSuggestions } from '../lib/telegram/pipeline.js';

const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && b.length > 0 && crypto.timingSafeEqual(digest(a), digest(b));
const LOOKUP_PER_MIN = 60; // telegram-id lookups per address per minute

/**
 * @param {object} [o]
 * @param {(req:any)=>Promise<string|null>} [o.verifyUser] verified Supabase user id from the bearer token (link codes are only minted for the caller's own account)
 * @param {(link:any)=>any} [o.botFactory] builds the webhook bot around the shared link service (null: webhook answers 503)
 * @param {string} [o.webhookSecret] TELEGRAM_WEBHOOK_SECRET; the webhook fails closed without it
 */
export function createTelegramRouter({ supabase = defaultSupabase, workerSecret = '', now = () => Date.now(), limits = {}, verifyUser = verifiedUserId, botFactory = null, webhookSecret = '', events = channelEvents } = {}) {
    const link = createLinkService({ supabase, now, limits });
    const lookupLimit = limits.lookupPerMin ?? LOOKUP_PER_MIN;
    const router = express.Router();
    const bot = botFactory ? botFactory(link) : null;
    router.bot = bot;

    const lookupIp = createWindowLimiter({ windowMs: 60_000, max: lookupLimit, now });
    const tooMany = (res, ms) => { res.set('Retry-After', String(Math.max(1, Math.ceil(ms / 1000)))); return res.status(429).json({ error: 'Too many attempts, try again later' }); };

    /** Common minting path for /connect and /link: the caller must prove they own the account the code is for. */
    async function mintFor(req, res, userId) {
        const verified = await verifyUser(req);
        if (!verified) { res.status(401).json({ error: 'Sign in to connect your account' }); return null; }
        if (verified !== String(userId)) { res.status(403).json({ error: 'You can only connect your own account' }); return null; }
        const m = link.mint(String(userId), req.ip);
        if (!m.ok) { if (m.status === 503) res.status(503).json({ error: 'busy' }); else tooMany(res, m.retryAfterMs); return null; }
        return m.code;
    }

    // POST /api/telegram/webhook/:secret - Telegram delivers bot updates here (set once with setWebhook, see docs/channels.md).
    // Fails closed: without the token and secret in the environment it answers 503; with them, BOTH the path secret and the
    // X-Telegram-Bot-Api-Secret-Token header must match (constant-time). It replies 200 at once and does the work afterwards,
    // so Telegram never times out and retries.
    router.post('/webhook/:secret', (req, res) => {
        if (!bot || !webhookSecret) return res.status(503).json({ error: 'Telegram bot not configured' });
        const pathOk = safeEqual(req.params.secret, webhookSecret);
        const headerOk = safeEqual(req.get('x-telegram-bot-api-secret-token'), webhookSecret);
        if (!pathOk || !headerOk) return res.status(401).json({ error: 'Unauthorized' });
        res.json({ ok: true });
        const update = req.body;
        setImmediate(() => { Promise.resolve(bot.handleUpdate(update)).catch(() => {}); });
    });

    // GET /api/telegram/stats?days=7 - channel funnel numbers (worker secret). The same numbers as docs/channels-metrics.md, for a quick look.
    router.get('/stats', async (req, res) => {
        if (!safeEqual(String(req.headers['x-worker-secret'] || ''), workerSecret)) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
            const since = new Date(now() - days * 86_400_000).toISOString();
            const rows = [];
            for (let page = 0; page < 50; page++) {
                const { data, error } = await supabase.from('channel_events').select('event, language, chat_ref, props, created_at').eq('channel', 'telegram').gte('created_at', since).order('created_at', { ascending: true }).range(page * 1000, page * 1000 + 999);
                if (error) return res.status(503).json({ error: 'channel_events not available (migration not applied?)' });
                rows.push(...(data || []));
                if (!data || data.length < 1000) break;
            }
            const totals = {}; const byLanguage = {}; const bySource = {}; const chats = new Set();
            for (const r of rows) {
                totals[r.event] = (totals[r.event] || 0) + 1;
                if (r.chat_ref) chats.add(r.chat_ref);
                const lang = r.language || 'unknown';
                byLanguage[lang] ||= {}; byLanguage[lang][r.event] = (byLanguage[lang][r.event] || 0) + 1;
                if (r.event === 'start') { const s = r.props?.start_payload || 'none'; bySource[s] = (bySource[s] || 0) + 1; }
            }
            res.json({ success: true, days, events: rows.length, distinctChats: chats.size, totals, byLanguage, startsByPayload: bySource, truncated: rows.length >= 50_000 });
        } catch (error) {
            console.error('[telegram/stats] Error:', error.message);
            res.status(500).json({ error: 'Failed to read stats' });
        }
    });

    // GET /api/telegram/connect?tg_id=X&user_id=Y - called by the web /connect page after sign-in (Authorization: Bearer <token>).
    // Generates a code that links a chat identity (Telegram, SMS or WhatsApp) to the signed-in VibeBuild account.
    router.get('/connect', async (req, res) => {
        try {
            const { tg_id, user_id } = req.query;
            if (!tg_id || !user_id) return res.status(400).json({ error: 'tg_id and user_id are required' });
            const code = await mintFor(req, res, user_id);
            if (!code) return;
            res.json({ success: true, code, expiresIn: 600 });
        } catch (error) {
            console.error('[telegram/connect] Error:', error.message);
            res.status(500).json({ error: 'Failed to generate connect code' });
        }
    });

    // POST /api/telegram/link - Generate a link code for the signed-in user (Authorization: Bearer <token>); the app opens botUrl.
    router.post('/link', async (req, res) => {
        try {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId is required' });
            const code = await mintFor(req, res, userId);
            if (!code) return;
            res.json({ success: true, code, botUrl: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME || 'Vibebuilder_bot'}?start=link_${code}`, expiresIn: 600 });
        } catch (error) {
            console.error('[telegram/link] Error:', error.message);
            res.status(500).json({ error: 'Failed to generate link code' });
        }
    });

    // POST /api/telegram/verify - Verify a link code (called by the SMS/WhatsApp bot; the Telegram bot calls the same service in-process)
    router.post('/verify', async (req, res) => {
        try {
            const { code, telegramId, telegramUsername } = req.body;
            if (!code || !telegramId) {
                return res.status(400).json({ error: 'code and telegramId are required' });
            }
            const r = await link.consume({ code, key: req.ip, telegramId, telegramUsername });
            if (!r.ok) return r.status === 429 ? tooMany(res, r.retryAfterMs) : res.status(r.status).json({ error: r.error });
            res.json({ success: true, userId: r.userId, displayName: r.displayName, subscriptionTier: r.subscriptionTier });
        } catch (error) {
            console.error('[telegram/verify] Error:', error.message);
            res.status(500).json({ error: 'Failed to verify code' });
        }
    });

    // GET /api/telegram/user/:telegramId - Look up user by chat id (Telegram id, or a phone number for the SMS/WhatsApp bot)
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

// Telegram linking is switched off by default (nearly unused). Set TELEGRAM_ROUTES_ENABLED=true (exactly) to serve it again.
function createDisabledRouter() {
    const router = express.Router();
    router.use((req, res) => res.status(503).json({ error: 'disabled' }));
    return router;
}

/** Builds the bot only when both the token and a webhook secret (16+ characters) are present; otherwise null and the webhook answers 503. */
export function defaultBotFactory(env = process.env, { supabase = defaultSupabase, events = channelEvents, api, builds, suggestions, config } = {}) {
    const telegramApi = api || createTelegramApi({ token: env.TELEGRAM_BOT_TOKEN });
    if (!telegramApi || String(env.TELEGRAM_WEBHOOK_SECRET || '').length < 16) return null;
    return (link) => {
        const bot = createBot({ api: telegramApi, db: supabase, link, builds: builds || createLoopbackBuilds(), suggestions: suggestions || createLoopbackSuggestions(), events, config: { botUsername: env.TELEGRAM_BOT_USERNAME || 'Vibebuilder_bot', webBase: env.WEB_APP_URL || 'https://vibebuild.cc', ...config } });
        // Pick up builds that were being followed when the previous process stopped (their owners still get the link).
        if (env.NODE_ENV !== 'test') setTimeout(() => { bot.resumeActive().catch(() => {}); }, 8000).unref();
        return bot;
    };
}

export function selectTelegramRouter(env = process.env, deps = {}) {
    if (env.TELEGRAM_ROUTES_ENABLED !== 'true') return createDisabledRouter();
    return createTelegramRouter({ workerSecret: WORKER_SECRET, webhookSecret: String(env.TELEGRAM_WEBHOOK_SECRET || ''), botFactory: defaultBotFactory(env), ...deps });
}

export default selectTelegramRouter();
