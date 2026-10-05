// End-user sign-in for generated apps: request a magic link by email, consume it once for a session token, verify and revoke
// sessions. Tokens are per-app JWTs plus a server-side session row, so sign-out and kill switches take effect immediately.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { deriveAppKey } from './keys.js';
import { signToken, verifyToken } from './jwt.js';

const EMAIL = /^[^\s@<>"',;:\\()[\]]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const LINK_TTL_MS = 15 * 60_000;
const SESSION_TTL_SEC = 30 * 24 * 3600;
const sha = (t) => createHash('sha256').update(t).digest();

export function createAuthService({ store, limiterStore, mailer, linkFor, masterKey, now = () => Date.now(), limits = {} }) {
    const L = { perEmailPerHour: 5, perIpPerHour: 20, perAppPerDay: 200, ...limits };
    const key = (appId) => deriveAppKey(masterKey, appId);
    const hour = () => Math.floor(now() / 3_600_000);
    const day = () => new Date(now()).toISOString().slice(0, 10);

    return {
        // Always answers the same for a well-formed email, whether or not an account exists.
        async requestLink({ appId, email, ip }) {
            const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
            if (e.length > 254 || !EMAIL.test(e)) return { ok: false, reason: 'invalid_email' };
            try {
                if ((await limiterStore.incr(`authmail:${appId}:${e}:${hour()}`, 7200)) > L.perEmailPerHour) return { ok: false, reason: 'rate_limited' };
                if ((await limiterStore.incr(`authip:${appId}:${ip}:${hour()}`, 7200)) > L.perIpPerHour) return { ok: false, reason: 'rate_limited' };
                if ((await limiterStore.incr(`authapp:${appId}:${day()}`, 26 * 3600)) > L.perAppPerDay) return { ok: false, reason: 'rate_limited' };
            } catch { return { ok: false, reason: 'unavailable' }; }
            const token = randomBytes(32).toString('base64url');
            try {
                await store.addLink({ tokenHash: sha(token), appId, email: e, expiresAt: now() + LINK_TTL_MS });
                await mailer.send({ to: e, appId, link: await linkFor(appId, token) });
            } catch { return { ok: false, reason: 'send_failed' }; }
            return { ok: true };
        },

        async consumeLink({ appId, token }) {
            if (typeof token !== 'string' || token.length < 20 || token.length > 100) return { ok: false, reason: 'invalid_link' };
            const email = await store.consumeLink({ tokenHash: sha(token), appId, now: now() });
            if (!email) return { ok: false, reason: 'invalid_link' };
            const userId = await store.upsertUser({ appId, email });
            const jti = randomUUID();
            await store.createSession({ jti, appId, userId, expiresAt: now() + SESSION_TTL_SEC * 1000 });
            return { ok: true, token: signToken({ key: key(appId), appId, sub: userId, jti, ttlSec: SESSION_TTL_SEC, now: now() }), user: { id: userId, email } };
        },

        async verifySession({ appId, token }) {
            const v = verifyToken({ key: key(appId), appId, token, now: now() });
            if (!v.ok) return { ok: false, reason: v.reason };
            const s = await store.activeSession({ jti: v.claims.jti, appId, now: now() });
            if (!s || s.userId !== v.claims.sub) return { ok: false, reason: 'revoked' };
            return { ok: true, user: { id: s.userId, email: s.email } };
        },

        async signOut({ appId, token }) {
            const v = verifyToken({ key: key(appId), appId, token, now: now() });
            if (!v.ok) return { ok: false, reason: v.reason };
            await store.revokeSession({ jti: v.claims.jti, appId, now: now() });
            return { ok: true };
        },
    };
}
