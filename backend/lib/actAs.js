// Who may act as a user id that arrives in a request body. Project routes used to trust that id outright, and creator ids are
// public (every project lists its creator), so anyone could delete, rename, revert or tweak another person's project.
//
// Real accounts (a users row with an email, written only for a verified sign-in) must prove the id with their own access token.
// Anonymous device ids (the iOS app has no login) have nothing to protect and keep working without a token, as in auth.routes.js.
// Fails closed: if the account lookup errors, the caller is not let through.
import { supabase as defaultClient } from '../config/database.js';
import { verifiedUserId } from './verifiedUser.js';

/** 'ok' | 'unauthenticated' (real account, no valid token) | 'forbidden' (token proves a different user, or no usable id) */
export async function actorStatus(req, userId, { verifyUser = verifiedUserId, client = defaultClient } = {}) {
    if (typeof userId !== 'string' || !userId) return 'forbidden';
    const verified = await verifyUser(req);
    if (verified) return verified === userId ? 'ok' : 'forbidden';
    try {
        const { data: row, error } = await client.from('users').select('email').eq('user_id', userId).maybeSingle();
        if (error) return 'unauthenticated';
        return row?.email ? 'unauthenticated' : 'ok';
    } catch {
        return 'unauthenticated';
    }
}

/** Sends the 401/403 and returns true when the caller may not act as userId; returns false when the route may continue. */
export async function denyUnlessActor(req, res, userId, deps) {
    const status = await actorStatus(req, userId, deps);
    if (status === 'ok') return false;
    if (status === 'unauthenticated') res.status(401).json({ error: 'Sign in again to do that.' });
    else res.status(403).json({ error: 'You can only change your own projects.' });
    return true;
}
