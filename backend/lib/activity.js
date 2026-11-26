// "Did this person come back?" One app_open usage event per signed-in person per UTC day, written from the access token that
// the web app and the Android app already send, so it needs no app release. It never delays or changes the request.
//
// The token's user id is read without verification only to skip people already counted today; nothing is written until
// Supabase Auth has vouched for the token. The database keeps one row per person per day (unique index app_events_app_open_daily).
import { createHash } from 'node:crypto';
import { verifiedUserId } from './verifiedUser.js';
import { appEvents, channelFromRequest } from './appEventsInstance.js';

// Requests that are not a person opening the product: health and status polls, machine callbacks and webhooks, generated apps'
// own traffic, the token upload (the app can be woken in the background to send it) and account deletion.
const NOT_AN_OPEN = /^\/api\/(health|status|webhooks|appdata|telegram|generate-auth|auth\/push-token|auth\/account|subscriptions\/stripe-webhook|projects\/track-play|projects\/[^/]+\/build-complete|deploy\/internal)(\/|$)/i;
const JWT = /^Bearer [A-Za-z0-9_-]+\.([A-Za-z0-9_-]{1,4000})\.[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRY_AFTER_MS = 5 * 60_000;

function claimedUserId(header) {
    const m = JWT.exec(header || '');
    if (!m) return null;
    try {
        const { sub } = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
        return typeof sub === 'string' && UUID.test(sub) ? sub : null;
    } catch { return null; }
}

const keep = (map, key, value, max) => { map.set(key, value); while (map.size > max) map.delete(map.keys().next().value); };

export function createActivityRecorder({ verify = verifiedUserId, record = appEvents.record, now = () => Date.now(), maxPending = 20, maxKeys = 20_000 } = {}) {
    const counted = new Map(); // `${userId}|${day}` -> true
    const refused = new Map(); // token digest -> retry time (an expired or forged token is not looked up again at once)
    const pending = new Set();

    /** Resolves when the lookup and write (if any) are done. Never throws. */
    async function note(req) {
        let key;
        try {
            if (req.method === 'OPTIONS' || NOT_AN_OPEN.test(req.path || '')) return;
            const header = req.headers?.authorization;
            const claimed = claimedUserId(header);
            if (!claimed) return;
            const k = `${claimed}|${new Date(now()).toISOString().slice(0, 10)}`;
            if (counted.has(k) || pending.has(k) || pending.size >= maxPending) return;
            const digest = createHash('sha256').update(header).digest('base64');
            if ((refused.get(digest) || 0) > now()) return;
            key = k;
            pending.add(key);
            const userId = await verify(req);
            if (userId !== claimed) { keep(refused, digest, now() + RETRY_AFTER_MS, maxKeys); return; }
            const version = req.headers?.['x-app-version'];
            const r = await record('app_open', { userId, props: { source: channelFromRequest(req), ...(version && { app_version: version }) } });
            if (r?.ok || r?.reason === 'duplicate') keep(counted, key, true, maxKeys);
        } catch { /* counting must never affect a request */ } finally {
            if (key) pending.delete(key);
        }
    }

    const middleware = (req, res, next) => { void note(req); next(); };
    return { note, middleware };
}
