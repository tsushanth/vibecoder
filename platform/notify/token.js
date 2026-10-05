// Signed per-user unsubscribe tokens: base64url(userId) "." base64url(HMAC-SHA256(appKey, "<appId>:<userId>")).
// The key comes from the app key derivation with its own purpose label, so it is not the session signing key and a
// token for one app never verifies on another. The token has no expiry on purpose: an unsubscribe link in an old
// email must keep working.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { deriveAppKey } from '../auth/keys.js';

export const UNSUB_PURPOSE = 'vibe-notify-unsub-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mac = (masterKey, appId, userId) => createHmac('sha256', deriveAppKey(masterKey, appId, UNSUB_PURPOSE)).update(`${appId}:${userId}`).digest();

export const isUserId = (v) => typeof v === 'string' && UUID.test(v);

export function signUnsubscribe({ masterKey, appId, userId }) {
    if (!isUserId(userId)) throw new Error('invalid user id');
    return `${Buffer.from(userId).toString('base64url')}.${mac(masterKey, appId, userId).toString('base64url')}`;
}

export function verifyUnsubscribe({ masterKey, appId, token }) {
    if (typeof token !== 'string' || token.length > 200) return { ok: false };
    const parts = token.split('.');
    if (parts.length !== 2) return { ok: false };
    const userId = Buffer.from(parts[0], 'base64url').toString('utf8');
    if (!isUserId(userId)) return { ok: false };
    const given = Buffer.from(parts[1], 'base64url');
    if (given.toString('base64url') !== parts[1] || Buffer.from(userId).toString('base64url') !== parts[0]) return { ok: false }; // one canonical spelling per token
    const want = mac(masterKey, appId, userId);
    return given.length === want.length && timingSafeEqual(given, want) ? { ok: true, userId } : { ok: false };
}
