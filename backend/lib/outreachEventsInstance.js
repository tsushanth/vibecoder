// Outreach metrics bound to the service-role database client (see lib/outreachEvents.js). All entry points are fire and forget.
import { supabase } from '../config/database.js';
import { sanitizeSignupSource } from './signupSource.js';
import { outreachAttribution, reportActivationForUser, reportOutreachEvent } from './outreachEvents.js';

/** A new real account (verified sign-in that created the row). `signupSource` is the raw body object; `email` the stored one. */
export function noteSignup(email, signupSource) {
    try {
        const attribution = outreachAttribution(sanitizeSignupSource(signupSource));
        if (attribution && email) reportOutreachEvent({ event: 'signup', attribution, email });
    } catch { /* never affects signup */ }
}

// Only for users whose stored first touch is an outreach one, and only when the project just created is their first.
async function lookupFirstProject(userId, projectId) {
    const { data } = await supabase.from('users').select('email, utm_source, utm_campaign, utm_content').eq('user_id', userId).maybeSingle();
    const attribution = outreachAttribution(data);
    if (!attribution || !data?.email) return null;
    let q = supabase.from('projects').select('id', { count: 'exact', head: true }).eq('creator_id', userId);
    if (projectId) q = q.neq('id', projectId);
    const { count, error } = await q;
    if (error || (count ?? 0) > 0) return null;
    return { attribution, email: data.email };
}

/** Call right after a project row was created for `userId`. */
export function noteProjectCreated(userId, projectId) {
    try { reportActivationForUser(userId, (id) => lookupFirstProject(id, projectId)); } catch { /* never affects a build */ }
}
