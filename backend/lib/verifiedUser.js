// The user id Supabase Auth vouches for in the caller's access token. Routes that guard secrets must use this and nothing
// from the request body or query.
import { supabase as defaultClient } from '../config/database.js';

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{1,4096})$/;

/** Returns the verified Supabase auth user (an object with a string id) or null. Never reads req.body or req.query. */
export async function verifiedUser(req, client = defaultClient) {
    const m = BEARER.exec(req?.headers?.authorization || '');
    if (!m || typeof client?.auth?.getUser !== 'function') return null;
    try {
        const { data, error } = await client.auth.getUser(m[1]);
        const user = data?.user;
        return !error && typeof user?.id === 'string' && user.id ? user : null;
    } catch {
        return null;
    }
}

/** Returns the verified user id (string) or null. Never reads req.body or req.query. */
export async function verifiedUserId(req, client = defaultClient) {
    return (await verifiedUser(req, client))?.id ?? null;
}
