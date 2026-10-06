import express from 'express';
import { supabase, supabaseAdmin } from '../config/database.js';
import { verifiedUserId } from '../lib/verifiedUser.js';

export function createAuthRouter({ verifyUser = verifiedUserId } = {}) {
const router = express.Router();

// DELETE /api/auth/account - Delete user account and all associated data
router.delete('/account', async (req, res) => {
    try {
        // Deleting an account is irreversible, and user ids are not secret (a creator id is part of every public project), so
        // the caller must prove who they are with their own access token; a userId in the body is never trusted.
        const userId = await verifyUser(req);
        if (!userId) return res.status(401).json({ error: 'Sign in again to delete your account.' });
        if (typeof req.body?.userId === 'string' && req.body.userId !== userId) return res.status(403).json({ error: 'You can only delete your own account.' });

        // Delete the user's data in dependency order. A project's deployments reference it, so they go first; the old
        // list filtered deployments by a column that does not exist, so the project, and then the user, could never be deleted
        // while the login was removed anyway, which left the account's data behind.
        const failed = [];
        const run = async (table, build) => {
            const { error } = await build(supabase.from(table));
            if (error) { failed.push(table); console.warn(`Warning: failed to delete from ${table}:`, error.message); }
        };
        const { data: mine } = await supabase.from('projects').select('id').eq('creator_id', userId);
        const projectIds = (mine || []).map((p) => p.id);
        await run('project_chats', (q) => q.delete().eq('user_id', userId));
        if (projectIds.length) await run('deployments', (q) => q.delete().in('project_id', projectIds));
        await run('projects', (q) => q.delete().eq('creator_id', userId));
        await run('coin_transactions', (q) => q.delete().eq('user_id', userId));
        await run('user_coins', (q) => q.delete().eq('user_id', userId));
        await run('users', (q) => q.delete().eq('user_id', userId));
        // Only remove the login once the data is gone, so a failed attempt can be retried.
        if (failed.length) return res.status(500).json({ error: 'Could not delete all account data. Please try again.', failed });

        // Delete auth user via admin API if available
        if (supabaseAdmin) {
            const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
            if (authError) {
                console.warn('Warning: failed to delete auth user:', authError.message);
            }
        }

        res.json({ success: true, message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Account deletion error:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

// Real accounts (a row with an email, written only for a verified sign-in) are protected: changing one needs the owner's own
// access token. Anonymous device ids (the iOS app has no login) have nothing to protect and keep working without a token.
// 'ok' = the caller may act on this user id, 'forbidden' = a real account and the token does not prove ownership.
async function mayActAs(req, userId, verifyUser) {
    const verified = await verifyUser(req);
    if (verified) return verified === userId ? 'ok' : 'forbidden';
    const { data: row } = await supabase.from('users').select('email').eq('user_id', userId).maybeSingle();
    return row?.email ? 'forbidden' : 'ok';
}

router.post('/register', async (req, res) => {
    try {
        const { userId, email, displayName, avatarUrl } = req.body;
        if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'userId is required' });
        const verified = await verifyUser(req);
        if (verified && verified !== userId) return res.status(403).json({ error: 'You can only register your own account.' });

        if (verified) {
            // A verified sign-in may create or update its own row, including the email.
            const { data, error } = await supabase
                .from('users')
                .upsert({
                    user_id: userId,
                    email: email || null,
                    display_name: displayName || 'Anonymous',
                    avatar_url: avatarUrl || null,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' })
                .select()
                .single();
            if (error) throw error;
            return res.json({ success: true, user: data });
        }

        // No token: this can only create a missing anonymous row. It never touches an existing row (anyone can guess or read
        // a user id) and an email claimed without proof is not stored, so it cannot mark a row as a real account.
        const { data: existing } = await supabase.from('users').select('user_id, display_name').eq('user_id', userId).maybeSingle();
        if (existing) return res.json({ success: true, user: existing });
        const { data, error } = await supabase
            .from('users')
            .insert({ user_id: userId, email: null, display_name: displayName || 'Anonymous', avatar_url: null, updated_at: new Date().toISOString() })
            .select()
            .single();
        if (error) throw error;
        res.json({ success: true, user: data });
    } catch (error) {
        console.error('Auth register error:', error);
        res.status(500).json({ error: 'Failed to register user' });
    }
});

// POST /api/auth/push-token - Register or update FCM/APNs device token
router.post('/push-token', async (req, res) => {
    try {
        const { userId, token, platform } = req.body;
        if (!userId || !token) {
            return res.status(400).json({ error: 'userId and token are required' });
        }
        // Otherwise anyone who knows a user id could send that user's notifications to their own device.
        if (await mayActAs(req, userId, verifyUser) !== 'ok') return res.status(403).json({ error: 'Sign in as this user to register a device.' });

        if (platform === 'android') {
            // Store FCM token in users table fcm_token column (may not exist yet - soft fail)
            const { error } = await supabase
                .from('users')
                .update({ fcm_token: token, updated_at: new Date().toISOString() })
                .eq('user_id', userId);
            if (error) console.warn('[push-token] FCM token store failed (column may not exist yet):', error.message);
        } else {
            // iOS APNs token - use existing push_tokens table schema
            const { error } = await supabase
                .from('push_tokens')
                .upsert({ user_id: userId, apns_token: token, sandbox: false, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id' });
            if (error) throw error;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Push token error:', error);
        res.status(500).json({ error: 'Failed to register push token' });
    }
});


return router;
}

export default createAuthRouter();
