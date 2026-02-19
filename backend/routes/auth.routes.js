import express from 'express';
import { supabase } from '../config/database.js';

const router = express.Router();

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

export default router;
