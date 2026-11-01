// THE one switch for "VibeBuild is free for now" (owner decision 2026-11-01).
//
//   VIBEBUILD_ALL_FREE unset or anything but an off-word  -> ON  (every user gets every Pro capability, fair-use caps only)
//   VIBEBUILD_ALL_FREE=0 (also false / off / no)          -> OFF (the old Free / Pro / Team tiers apply again, unchanged)
//
// Nothing else reads that variable: every other file asks allFreeEnabled(). The stored user_subscriptions rows are never rewritten
// by this mode, so flipping the switch back restores the old behaviour exactly (flyctl secrets set VIBEBUILD_ALL_FREE=0 -a vibecoder-api).
// The web has its own build-time switch (web/src/lib/pricing.ts); the Android app reads the status endpoint's `allFree` flag.

const OFF_WORDS = new Set(['0', 'false', 'off', 'no']);

export function allFreeEnabled(env = process.env) {
    const v = env.VIBEBUILD_ALL_FREE;
    if (v === undefined || v === null) return true;
    return !OFF_WORDS.has(String(v).trim().toLowerCase());
}

function intFrom(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** The fair-use numbers that replace the old 10/day and 3-tweaks caps while the switch is on. Read per call so tests and flyctl env changes apply. */
export function fairUseConfig(env = process.env) {
    return {
        dailyGenerations: intFrom(env.VIBEBUILD_FAIR_USE_DAILY_GENERATIONS, 30),
        tweaksPerProject: intFrom(env.VIBEBUILD_FAIR_USE_TWEAKS_PER_PROJECT, 50),
        dailyBuildsAlertThreshold: intFrom(env.VIBEBUILD_DAILY_BUILDS_ALERT_THRESHOLD, 300),
    };
}

/** Old-mode text when the switch is off, new text when it is on (for upsell copy that must disappear while everything is free). */
export function whenAllFree(freeText, oldText) {
    return allFreeEnabled() ? freeText : oldText;
}
