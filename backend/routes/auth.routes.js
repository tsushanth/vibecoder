import express from 'express';
import { supabase, supabaseAdmin } from '../config/database.js';

const router = express.Router();

// DELETE /api/auth/account - Delete user account and all associated data
router.delete('/account', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        // Delete user's data from all tables (cascade)
        const tables = [
            { table: 'project_chats', column: 'user_id' },
            { table: 'deployments', column: 'creator_id' },
            { table: 'projects', column: 'creator_id' },
            { table: 'coin_transactions', column: 'user_id' },
            { table: 'user_coins', column: 'user_id' },
            { table: 'users', column: 'user_id' },
        ];

        for (const { table, column } of tables) {
            const { error } = await supabase
                .from(table)
                .delete()
                .eq(column, userId);
            if (error) {
                console.warn(`Warning: failed to delete from ${table}:`, error.message);
            }
        }

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

router.post('/register', async (req, res) => {
    try {
        const { userId, email, displayName, avatarUrl } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

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


export default router;
