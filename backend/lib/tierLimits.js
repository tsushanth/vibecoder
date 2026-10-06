// What a subscription tier does to an app's usage limits. There is no per-unit billing: the plan sets how big the caps are.
// Free keeps the platform defaults; Pro and Team scale every cap by a fixed factor. The defaults themselves live in the proxy, so
// the caller passes them in (read from GET /admin/apps/:app/limits) and nothing here can drift from them.
export const TIER_MULTIPLIER = Object.freeze({ free: 1, pro: 5, team: 20 });

/** The override object for a tier: {} for Free (clears every override), defaults x multiplier for paid tiers. */
export function overridesForTier(tier, defaults) {
    const m = typeof tier === 'string' && Object.hasOwn(TIER_MULTIPLIER, tier) ? TIER_MULTIPLIER[tier] : 1;
    if (m === 1 || !defaults || typeof defaults !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(defaults)) if (Number.isInteger(v) && v >= 0) out[k] = v * m;
    return out;
}

export function sameOverrides(a, b) {
    const ka = Object.keys(a || {}).sort(), kb = Object.keys(b || {}).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}
