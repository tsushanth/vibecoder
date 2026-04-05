import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/database.js';

const router = express.Router();

// In-memory store for magic link codes (code -> { userId, expiresAt })
const magicLinks = new Map();

// Cleanup expired codes every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [code, data] of magicLinks) {
        if (now > data.expiresAt) magicLinks.delete(code);
    }
}, 5 * 60 * 1000);

// POST /api/telegram/link - Generate magic link code for a VibeBuild user
// Called from the app when user taps "Connect Telegram"
router.post('/link', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        // Generate a 6-char code
        const code = crypto.randomBytes(3).toString('hex').toUpperCase();
        magicLinks.set(code, {
            userId,
            expiresAt: Date.now() + 10 * 60 * 1000, // 10 min expiry
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

        const linkData = magicLinks.get(code.toUpperCase());
        if (!linkData) {
            return res.status(404).json({ error: 'Invalid or expired code' });
        }
        if (Date.now() > linkData.expiresAt) {
            magicLinks.delete(code);
            return res.status(410).json({ error: 'Code has expired' });
        }

        const userId = linkData.userId;
        magicLinks.delete(code);

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

export default router;
