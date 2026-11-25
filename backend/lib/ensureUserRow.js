// Every build hangs on a users row: projects.creator_id (and the coin, deployment, domain and chat tables) reference
// users(user_id). The row used to come only from POST /api/auth/register, which a client can fail to send (the Android app
// cancelled it when its sign-in screen closed), and such an account was then refused every build. So a write request that
// carries a valid access token creates the missing row first, from the verified token alone: nothing in the body or query is
// used, an existing row is never changed, and a request without a verifiable token creates nothing.
import { supabase as defaultClient } from '../config/database.js';
import { verifiedUser } from './verifiedUser.js';
import { recordSignupSource } from './signupSource.js';
import { appEvents, sourceFromRequest } from './appEventsInstance.js';
import { noteSignup } from './outreachEventsInstance.js';
import { reportFailure } from './failureReporter.js';

// Write requests that act for a signed-in person. Left out on purpose: /api/auth/register (it creates the row itself and records
// first-touch attribution), account deletion, and webhooks (no user token).
const NEEDS_ROW = /^\/api\/(projects|events|deploy|domains|github|subscriptions|telegram\/link|auth\/push-token)(\/|$)/i;
const NEEDS_ROW_GET = /^\/api\/telegram\/connect\/?$/i; // a GET that links a chat to the account, which updates the row
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function needsUserRow(req) {
    if (req.method === 'GET') return NEEDS_ROW_GET.test(req.path);
    return WRITES.has(req.method) && NEEDS_ROW.test(req.path);
}

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** The row for a verified auth user, within the column limits. */
export function rowFromAuthUser(user, now = new Date()) {
    const meta = user.user_metadata || {};
    const email = typeof user.email === 'string' && user.email && user.email.length <= 255 ? user.email : null;
    return {
        user_id: user.id,
        email,
        display_name: text(meta.full_name, 100) || text(meta.name, 100) || 'Anonymous',
        avatar_url: text(meta.avatar_url, 2048) || text(meta.picture, 2048),
        updated_at: now.toISOString(),
    };
}

async function afterCreate(client, req, row) {
    await recordSignupSource(client, row.user_id, req, undefined);
    noteSignup(row.email, undefined);
    appEvents.emit('signup_completed', { userId: row.user_id, props: { source: sourceFromRequest(req) } });
}

/**
 * Returns an async (req) => 'created' | 'exists' | 'unverified' | 'failed'. Never throws, and never waits past timeoutMs:
 * the request goes on either way, and a build that is then refused is reported by lib/buildRefusal.js.
 */
export function createUserRowEnsurer({ client = defaultClient, verify = (req) => verifiedUser(req, client), onCreated = afterCreate, report = reportFailure, timeoutMs = 5000 } = {}) {
    async function ensure(req) {
        const user = await verify(req);
        if (!user) return 'unverified';
        const row = rowFromAuthUser(user);
        // One statement: insert, or do nothing when the row is there. Only a row this call created comes back.
        const { data, error } = await client.from('users').upsert(row, { onConflict: 'user_id', ignoreDuplicates: true }).select('user_id');
        if (error) {
            report('user_row_create_failed', new Error('USER_ROW_CREATE_FAILED: a signed-in account has no users row and one could not be created'), { error_name: String(error.code || 'none') });
            return 'failed';
        }
        if (!data?.length) return 'exists';
        console.log('[user-row] created a missing users row from a verified sign-in');
        await onCreated(client, req, row);
        return 'created';
    }
    return async function ensureUserRow(req) {
        let timer;
        try {
            const late = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs, 'failed'); timer.unref?.(); });
            return await Promise.race([ensure(req), late]);
        } catch {
            return 'failed';
        } finally {
            clearTimeout(timer);
        }
    };
}

/** Express middleware: ensures the row on the routes that need it, then continues whatever the outcome. */
export function userRowMiddleware(ensureUserRow = createUserRowEnsurer()) {
    return (req, res, next) => {
        if (!needsUserRow(req)) return next();
        ensureUserRow(req).then(() => next(), () => next());
    };
}
