// The user id Supabase Auth vouches for in the caller's access token. Routes that guard secrets must use this and nothing
// from the request body or query.
import { supabase as defaultClient } from '../config/database.js';

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{1,4096})$/;

/** Returns the verified user id (string) or null. Never reads req.body or req.query. */
export async function verifiedUserId(req, client = defaultClient) {
    const m = BEARER.exec(req?.headers?.authorization || '');
    if (!m || typeof client?.auth?.getUser !== 'function') return null;
    try {
        const { data, error } = await client.auth.getUser(m[1]);
        const id = data?.user?.id;
        return !error && typeof id === 'string' && id ? id : null;
    } catch {
        return null;
    }
}
