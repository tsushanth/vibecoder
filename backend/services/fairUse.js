// Fair-use limits while VIBEBUILD_ALL_FREE is on (see lib/allFree.js). These are abuse guards, never a paywall:
//   - a hit is HTTP 429 with a friendly message and no upgrade hint (the callers build the response from fairUseBody),
//   - every lookup FAILS OPEN: if the usage table cannot be read the action is allowed, the failure is logged and reported,
//   - counts come from subscription_usage (the same rows recordUsage writes), by UTC day for generations and by project for tweaks.
import { supabase } from '../config/database.js';
import { fairUseConfig } from '../lib/allFree.js';
import { reportFailure } from '../lib/failureReporter.js';

export const FAIR_USE_DAILY_MESSAGE = "You have reached today's fair-use limit, try again tomorrow.";
export const FAIR_USE_TWEAK_MESSAGE = (limit) => `You have reached the fair-use limit of ${limit} tweaks on this project. Start a new project to keep building.`;

export function utcDayStart(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
export function nextUtcMidnight(now = new Date()) {
    return new Date(utcDayStart(now).getTime() + 24 * 60 * 60 * 1000);
}

function lookupFailed(scope, err) {
    console.error(`[fair-use] ${scope} usage lookup failed (allowing): ${err?.code || err?.message || 'error'}`);
    reportFailure(`fair_use:${scope}_lookup_failed`, new Error('Fair-use usage lookup failed; request allowed'));
}

/** Rows counted today (UTC) for a user's action; null when the lookup failed (callers fail open). */
export async function countTodayUsage(userId, actionType, now = new Date()) {
    try {
        const { data, error } = await supabase
            .from('subscription_usage')
            .select('id')
            .eq('user_id', userId)
            .eq('action_type', actionType)
            .gte('created_at', utcDayStart(now).toISOString());
        if (error) { lookupFailed('daily', error); return null; }
        return data?.length || 0;
    } catch (e) { lookupFailed('daily', e); return null; }
}

/** Tweaks recorded against one project; null when the lookup failed. */
export async function countProjectTweaks(userId, projectId) {
    try {
        const { data, error } = await supabase
            .from('subscription_usage')
            .select('id')
            .eq('user_id', userId)
            .eq('action_type', 'tweak')
            .eq('project_id', projectId);
        if (error) { lookupFailed('tweak', error); return null; }
        return data?.length || 0;
    } catch (e) { lookupFailed('tweak', e); return null; }
}

/**
 * Fair-use decision for one action. Same result shape as checkUsageLimit so existing callers keep working:
 * { allowed, tier:'pro', allFree:true, used, limit, remaining, resetsAt? } and, when refused, { fairUse:true, scope, error }.
 */
export async function checkFairUse(userId, actionType, projectId = null, now = new Date()) {
    const cfg = fairUseConfig();
    const base = { tier: 'pro', allFree: true };
    if (actionType === 'create_private' || actionType === 'fork') return { allowed: true, ...base };

    if (actionType === 'generation') {
        const limit = cfg.dailyGenerations;
        const resetsAt = nextUtcMidnight(now).toISOString();
        if (!userId || userId === 'demo-user') return { allowed: true, ...base, used: 0, limit, remaining: limit, resetsAt };
        const used = await countTodayUsage(userId, 'generation', now);
        if (used === null) return { allowed: true, ...base, used: 0, limit, remaining: limit, resetsAt, degraded: true };
        if (used >= limit) {
            return { allowed: false, ...base, fairUse: true, scope: 'daily_generations', error: FAIR_USE_DAILY_MESSAGE, used, limit, remaining: 0, resetsAt };
        }
        return { allowed: true, ...base, used, limit, remaining: limit - used, resetsAt };
    }

    if (actionType === 'tweak') {
        if (!projectId) return { allowed: false, error: 'projectId is required for tweak actions' };
        const limit = cfg.tweaksPerProject;
        if (!userId || userId === 'demo-user') return { allowed: true, ...base, used: 0, limit, remaining: limit };
        const used = await countProjectTweaks(userId, projectId);
        if (used === null) return { allowed: true, ...base, used: 0, limit, remaining: limit, degraded: true };
        if (used >= limit) {
            return { allowed: false, ...base, fairUse: true, scope: 'tweaks_per_project', error: FAIR_USE_TWEAK_MESSAGE(limit), used, limit, remaining: 0 };
        }
        return { allowed: true, ...base, used, limit, remaining: limit - used };
    }

    return { allowed: false, error: 'Invalid action type or tier' };
}

/** JSON body for an HTTP 429 fair-use refusal. No tier, no upgrade hint. */
export function fairUseBody(check) {
    return {
        error: check.error,
        code: 'fair_use_limit',
        fairUse: true,
        scope: check.scope,
        used: check.used,
        limit: check.limit,
        remaining: check.remaining,
        ...(check.resetsAt && { resetsAt: check.resetsAt }),
    };
}

/** The numbers the status endpoint shows. Never throws; a failed lookup reports used 0 (and the failure was already reported). */
export async function fairUseSnapshot(userId, projectId = null, now = new Date()) {
    const cfg = fairUseConfig();
    const resetsAt = nextUtcMidnight(now).toISOString();
    const used = userId && userId !== 'demo-user' ? (await countTodayUsage(userId, 'generation', now)) ?? 0 : 0;
    const out = {
        dailyGenerations: { used, limit: cfg.dailyGenerations, remaining: Math.max(0, cfg.dailyGenerations - used), resetsAt },
        tweaksPerProject: { limit: cfg.tweaksPerProject },
    };
    if (projectId && userId && userId !== 'demo-user') {
        const t = (await countProjectTweaks(userId, projectId)) ?? 0;
        out.tweaksPerProject = { used: t, limit: cfg.tweaksPerProject, remaining: Math.max(0, cfg.tweaksPerProject - t) };
    }
    return out;
}

let alertedDay = null;
/**
 * Global safety net: when today's total builds pass the threshold, report once per UTC day per instance (the reporter emails the owner).
 * Counts only, stable message, and it NEVER blocks a build. Fire-and-forget.
 */
export async function reportIfDailyBuildsHigh(now = new Date()) {
    try {
        const day = utcDayStart(now).toISOString().slice(0, 10);
        if (alertedDay === day) return false;
        const threshold = fairUseConfig().dailyBuildsAlertThreshold;
        const { count, error } = await supabase
            .from('subscription_usage')
            .select('id', { count: 'exact', head: true })
            .eq('action_type', 'generation')
            .gte('created_at', utcDayStart(now).toISOString());
        if (error || typeof count !== 'number') return false;
        if (count <= threshold) return false;
        alertedDay = day;
        reportFailure('capacity:daily_builds_over_threshold', new Error('Daily VibeBuild builds passed the safety threshold'), { builds_today: String(count), threshold: String(threshold) });
        return true;
    } catch { return false; }
}
export function _resetDailyAlertForTests() { alertedDay = null; }
