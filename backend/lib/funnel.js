// Activation funnel marker: one structured log line the first time an account starts a build.
//
//   {"event":"signup_to_first_build_started","seconds_since_signup":212,"auto_start":true,"entry":"landing_prompt","platform":"web"}
//
// There is no analytics product behind VibeBuild, so the line goes to the API log (nothing personal in it: no user id, no
// prompt). The same funnel can always be rebuilt from the tables: the first projects row of a user minus users.created_at.
// `auto_start` says whether the build began without the person pressing Build (web: a prompt typed on the landing page).

const ENTRIES = new Set(['landing_prompt', 'composer']);

/** Pure: the log object, or null when this is not the account's first build. */
export function buildFirstBuildEvent({ priorProjects, signupAt, now = Date.now(), autoStart, entry, platform }) {
    if (!Number.isFinite(priorProjects) || priorProjects > 0) return null;
    const created = signupAt ? Date.parse(signupAt) : NaN;
    const seconds = Number.isFinite(created) && created <= now ? Math.round((now - created) / 1000) : null;
    return {
        event: 'signup_to_first_build_started',
        seconds_since_signup: seconds,
        auto_start: autoStart === true,
        entry: ENTRIES.has(entry) ? entry : 'composer',
        platform: platform === 'android' ? 'android' : 'web',
    };
}

/**
 * Fire-and-forget: look up whether this is the first build and log it. Never throws and never delays the build.
 * `projectId` is the row just created for this build; it is excluded from the "earlier builds" count.
 */
export async function logFirstBuildStarted(supabase, { userId, projectId, autoStart, entry, platform, log = console.log }) {
    try {
        if (!userId) return null;
        let q = supabase.from('projects').select('id', { count: 'exact', head: true }).eq('creator_id', userId);
        if (projectId) q = q.neq('id', projectId);
        const { count, error } = await q;
        if (error) return null;
        let signupAt = null;
        if ((count ?? 0) === 0) {
            const { data } = await supabase.from('users').select('created_at').eq('user_id', userId).maybeSingle();
            signupAt = data?.created_at || null;
        }
        const ev = buildFirstBuildEvent({ priorProjects: count ?? 0, signupAt, autoStart, entry, platform });
        if (ev) log(`[funnel] ${JSON.stringify(ev)}`);
        return ev;
    } catch {
        return null;
    }
}
