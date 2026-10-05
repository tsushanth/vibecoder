// The ONLY trustworthy identity in this backend: the user id Supabase Auth vouches for in the caller's access token.
// Most older routes trust a userId sent by the client; routes that guard secrets must use this instead.
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
