// The promotion funnel for GET /api/telegram/stats: impressions -> taps -> bot starts -> builds -> finished builds -> linked accounts,
// per surface. Pure functions over rows already read from the database, so the numbers can be tested without one.
//
// Two sources are joined only by SURFACE, never by person: the app records impressions and taps (app_events, signed-in user ids) and
// the bot records the start payload the surface put on its link (channel_events, a hashed chat id). A tap cannot be matched to the
// chat it opened, so the later steps count chats whose FIRST /start in the window carried that surface's payload. Chats that
// started before the window are counted under `unattributed`.
export const SURFACE_PAYLOAD = Object.freeze({
    banner: 'app',
    create_card: 'app_card',
    post_build: 'app_build',
    account_row: 'app_settings',
    web_home: 'web_home',
    web_connect: 'web_connect',
});
export const PROMO_EVENTS = Object.freeze(['promo_impression', 'promo_tap', 'promo_dismiss']);

const blank = () => ({ impressions: 0, impressionUsers: 0, taps: 0, tapUsers: 0, dismissals: 0, starts: 0, chats: 0, newChats: 0, built: 0, finished: 0, linked: 0 });

/**
 * @param {Array<{event:string, user_id?:string|null, props?:object}>} promoRows app_events rows (promo_* events)
 * @param {Array<{event:string, chat_ref?:string|null, props?:object}>} botRows channel_events rows (telegram), ascending by time
 */
export function summarizePromotion(promoRows = [], botRows = []) {
    const surfaces = {};
    for (const s of Object.keys(SURFACE_PAYLOAD)) surfaces[s] = blank();
    const unattributed = { chats: 0, built: 0, finished: 0, linked: 0 };
    const byLanguage = {};
    const users = { impression: {}, tap: {} };
    const bump = (lang, field) => { const l = lang || 'unknown'; byLanguage[l] ||= { impressions: 0, taps: 0 }; byLanguage[l][field]++; };

    for (const r of promoRows) {
        const surface = r.props?.surface; const row = surfaces[surface];
        if (!row) continue;
        if (r.event === 'promo_impression') {
            row.impressions++; bump(r.props?.lang, 'impressions');
            if (r.user_id) (users.impression[surface] ||= new Set()).add(r.user_id);
        } else if (r.event === 'promo_tap') {
            row.taps++; bump(r.props?.lang, 'taps');
            if (r.user_id) (users.tap[surface] ||= new Set()).add(r.user_id);
        } else if (r.event === 'promo_dismiss') row.dismissals++;
    }
    for (const s of Object.keys(surfaces)) { surfaces[s].impressionUsers = users.impression[s]?.size || 0; surfaces[s].tapUsers = users.tap[s]?.size || 0; }

    const payloadToSurface = Object.fromEntries(Object.entries(SURFACE_PAYLOAD).map(([s, p]) => [p, s]));
    const origin = new Map();   // chat_ref -> surface name, or null for a chat whose first /start was not from a surface
    const seen = { built: new Set(), finished: new Set(), linked: new Set() };
    const counted = new Set();
    for (const r of botRows) {
        const ref = r.chat_ref; if (!ref) continue;
        if (r.event === 'start') {
            const surface = payloadToSurface[r.props?.start_payload];
            if (surface) { surfaces[surface].starts++; if (r.props?.new_chat) surfaces[surface].newChats++; }
            if (!origin.has(ref)) origin.set(ref, surface || null);
            if (surface && !counted.has(ref)) { counted.add(ref); surfaces[surface].chats++; }
            continue;
        }
        const key = r.event === 'build_queued' ? 'built' : r.event === 'build_finished' ? 'finished' : r.event === 'link_done' ? 'linked' : null;
        if (!key || seen[key].has(ref)) continue;
        seen[key].add(ref);
        const surface = origin.get(ref);
        if (surface) surfaces[surface][key]++; else unattributed[key]++;
    }
    // chats seen in the window without a surface start
    const all = new Set(botRows.filter((r) => r.chat_ref).map((r) => r.chat_ref));
    unattributed.chats = [...all].filter((ref) => !origin.get(ref)).length;
    return { surfaces, unattributed, byLanguage, tapRate: Object.fromEntries(Object.entries(surfaces).map(([s, v]) => [s, v.impressions ? Math.round((v.taps / v.impressions) * 1000) / 1000 : null])) };
}
