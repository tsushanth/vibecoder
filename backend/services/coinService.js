import { supabase } from '../config/database.js';
import { COIN_PACKS, GENERATION_COST, TWEAK_COST, FORK_COST, CREATOR_SHARE_PCT } from '../config/constants.js';

export async function getCoinBalance(req, res) {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const { data, error } = await supabase
            .from('user_coins')
            .select('balance, total_purchased, total_spent, total_earned')
            .eq('user_id', userId)
            .single();

        if (error && error.code === 'PGRST116') {
            return res.json({ success: true, balance: 0, totalPurchased: 0, totalSpent: 0, totalEarned: 0 });
        }
        if (error) return res.status(500).json({ error: 'Failed to fetch balance' });

        res.json({
            success: true,
            balance: data.balance,
            totalPurchased: data.total_purchased,
            totalSpent: data.total_spent,
            totalEarned: data.total_earned
        });
    } catch (error) {
        console.error('getCoinBalance error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export async function purchaseCoins(req, res) {
    try {
        const { userId, productId, transactionId, platform } = req.body;
        if (!userId || !productId || !transactionId || !platform) {
            return res.status(400).json({ error: 'userId, productId, transactionId, and platform are required' });
        }

        const pack = COIN_PACKS[productId];
        if (!pack) return res.status(400).json({ error: 'Invalid product ID', validProducts: Object.keys(COIN_PACKS) });

        const { data, error } = await supabase.rpc('add_purchased_coins', {
            p_user_id: userId,
            p_amount: pack.coins,
            p_reason: productId,
            p_platform: platform,
            p_iap_transaction_id: transactionId
        });

        if (error) return res.status(500).json({ error: 'Failed to record purchase' });
        if (data.duplicate) return res.json({ success: true, message: 'Transaction already processed', balance: data.new_balance });

        res.json({ success: true, coinsAdded: pack.coins, newBalance: data.new_balance });
    } catch (error) {
        console.error('purchaseCoins error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export async function spendCoins(req, res) {
    try {
        const { userId, projectId, creatorId, reason, platform } = req.body;
        if (!userId || !reason) return res.status(400).json({ error: 'userId and reason are required' });

        let amount;
        if (reason === 'generation') amount = GENERATION_COST;
        else if (reason === 'tweak') amount = TWEAK_COST;
        else if (reason === 'fork') amount = FORK_COST;
        else amount = TWEAK_COST; // default

        const { data, error } = await supabase.rpc('spend_coins', {
            p_user_id: userId,
            p_amount: amount,
            p_reason: reason,
            p_game_id: projectId || null,
            p_creator_id: creatorId || null,
            p_platform: platform || null
        });

        if (error) return res.status(500).json({ error: 'Failed to spend coins' });
        if (!data.success) return res.status(400).json({ success: false, error: data.error, balance: data.balance || 0 });

        res.json({ success: true, coinsSpent: amount, newBalance: data.new_balance, creatorShare: data.creator_share });
    } catch (error) {
        console.error('spendCoins error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export async function getCreatorEarnings(req, res) {
    try {
        const { creatorId } = req.query;
        if (!creatorId) return res.status(400).json({ error: 'creatorId is required' });

        const { data: earnings, error } = await supabase
            .from('creator_earnings')
            .select('project_id, coins_earned, reason, created_at')
            .eq('creator_id', creatorId)
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: 'Failed to fetch earnings' });

        const totalEarned = (earnings || []).reduce((sum, e) => sum + e.coins_earned, 0);

        const projectIds = [...new Set((earnings || []).map(e => e.project_id).filter(Boolean))];
        let titleMap = {};
        if (projectIds.length > 0) {
            const { data: projects } = await supabase.from('projects').select('id, title').in('id', projectIds);
            if (projects) titleMap = Object.fromEntries(projects.map(p => [p.id, p.title]));
        }

        res.json({
            success: true,
            totalCoinsEarned: totalEarned,
            earnings: (earnings || []).map(e => ({ ...e, project_title: titleMap[e.project_id] || 'Untitled' }))
        });
    } catch (error) {
        console.error('getCreatorEarnings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export async function getTransactionHistory(req, res) {
    try {
        const { userId, limit = 50, offset = 0 } = req.query;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const { data, error } = await supabase
            .from('coin_transactions')
            .select('id, amount, type, reason, project_id, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (error) return res.status(500).json({ error: 'Failed to fetch transactions' });
        res.json({ success: true, transactions: data || [] });
    } catch (error) {
        console.error('getTransactionHistory error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export async function getCoinStore(req, res) {
    const packs = Object.entries(COIN_PACKS).map(([productId, info]) => ({
        productId, coins: info.coins, price: info.price
    }));
    res.json({
        success: true,
        generationCost: GENERATION_COST,
        tweakCost: TWEAK_COST,
        forkCost: FORK_COST,
        creatorSharePercent: CREATOR_SHARE_PCT,
        packs
    });
}

export async function awardCoins(req, res) {
    try {
        const { userId, amount, reason, platform } = req.body;
        if (!userId || !amount || !reason) return res.status(400).json({ error: 'userId, amount, and reason are required' });

        const { data, error } = await supabase.rpc('add_purchased_coins', {
            p_user_id: userId, p_amount: amount, p_reason: reason,
            p_platform: platform || null, p_iap_transaction_id: `award_${reason}_${Date.now()}`
        });

        if (error) return res.status(500).json({ error: 'Failed to award coins' });
        res.json({ success: true, coinsAdded: amount, newBalance: data.new_balance });
    } catch (error) {
        console.error('awardCoins error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
