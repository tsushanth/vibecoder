// Keeps each published app's usage limits in step with its creator's subscription tier. Best effort: a proxy or database problem is
// logged by error code only and never fails a deploy, a receipt check or a webhook.
import { overridesForTier, sameOverrides } from '../lib/tierLimits.js';

const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

/** 'applied' | 'unchanged' | 'skipped' | 'failed' */
export async function applyTierLimits(proxyAdmin, subdomain, tier, log = console.warn) {
    if (!proxyAdmin?.configured || typeof subdomain !== 'string' || !SUBDOMAIN.test(subdomain)) return 'skipped';
    try {
        const cur = await proxyAdmin.getLimits(subdomain);
        const want = overridesForTier(tier, cur?.defaults);
        if (sameOverrides(cur?.overrides, want)) return 'unchanged';
        await proxyAdmin.setLimits(subdomain, want);
        return 'applied';
    } catch (e) {
        if (e?.code === 'unknown_app') return 'skipped';
        log(`[tier] limits sync failed app=${subdomain} code=${e?.code || 'error'}`);
        return 'failed';
    }
}

/** Applies the user's current effective tier to every app they have published. */
export async function syncTierLimitsForUser({ supabase, proxyAdmin, userId, getStatus, log = console.warn }) {
    if (!proxyAdmin?.configured || typeof userId !== 'string' || !userId) return { applied: 0 };
    try {
        const { tier } = await getStatus(userId);
        const { data, error } = await supabase.from('deployments').select('subdomain').eq('user_id', userId).eq('status', 'active');
        if (error) throw error;
        let applied = 0;
        for (const d of data || []) if ((await applyTierLimits(proxyAdmin, d.subdomain, tier, log)) === 'applied') applied++;
        return { applied };
    } catch (e) {
        log(`[tier] user sync failed code=${e?.code || 'error'}`);
        return { applied: 0 };
    }
}

/**
 * Re-applies tiers for everyone who has (or had) a paid subscription row, which also catches expiries and downgrades because the
 * effective tier is recomputed. trigger() asks for an early run (debounced) after a subscription event.
 */
export function startTierSweep({ supabase, proxyAdmin, getStatus, intervalMs = 15 * 60_000, firstRunMs = 120_000, minGapMs = 60_000, log = console.warn, now = () => Date.now() }) {
    let last = 0; let running = null; let timer = null; let first = null;
    async function runOnce() {
        if (running) return running;
        running = (async () => {
            last = now();
            try {
                const { data, error } = await supabase.from('user_subscriptions').select('user_id').in('tier', ['pro', 'team']);
                if (error) throw error;
                for (const r of data || []) await syncTierLimitsForUser({ supabase, proxyAdmin, userId: r.user_id, getStatus, log });
            } catch (e) { log(`[tier] sweep failed code=${e?.code || 'error'}`); }
        })().finally(() => { running = null; });
        return running;
    }
    if (intervalMs > 0) { timer = setInterval(runOnce, intervalMs); timer.unref?.(); first = setTimeout(runOnce, firstRunMs); first.unref?.(); }
    return {
        runOnce,
        trigger() { if (now() - last >= minGapMs) return runOnce(); return null; },
        stop() { clearInterval(timer); clearTimeout(first); },
    };
}
