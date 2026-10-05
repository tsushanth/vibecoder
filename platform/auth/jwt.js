// Minimal HS256 JWTs for end users of generated apps. Strict on purpose: one algorithm, required claims, the token must be
// for exactly this app, and every failure is a reason code (never the token or the key).
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const HEADER = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const MAX_TOKEN = 2048;

export function signToken({ key, appId, sub, jti, ttlSec = 30 * 24 * 3600, now = Date.now() }) {
    const iat = Math.floor(now / 1000);
    const payload = b64u(JSON.stringify({ app_id: appId, sub, jti, iat, exp: iat + ttlSec }));
    const sig = createHmac('sha256', key).update(`${HEADER}.${payload}`).digest('base64url');
    return `${HEADER}.${payload}.${sig}`;
}

const bad = (reason) => ({ ok: false, reason });

export function verifyToken({ key, appId, token, now = Date.now() }) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN) return bad('malformed');
    const parts = token.split('.');
    if (parts.length !== 3) return bad('malformed');
    const [h, p, s] = parts;
    if (h !== HEADER) return bad('bad_header'); // rejects alg none, other algorithms and any header trick
    const expected = createHmac('sha256', key).update(`${h}.${p}`).digest();
    const given = Buffer.from(s, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return bad('bad_signature');
    let claims;
    try { claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return bad('malformed'); }
    if (!claims || typeof claims !== 'object') return bad('malformed');
    if (claims.app_id !== appId) return bad('wrong_app');
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.jti !== 'string' || !claims.jti) return bad('missing_claims');
    if (!Number.isInteger(claims.exp) || !Number.isInteger(claims.iat)) return bad('missing_claims');
    if (Math.floor(now / 1000) >= claims.exp) return bad('expired');
    if (claims.iat > Math.floor(now / 1000) + 60) return bad('not_yet_valid');
    return { ok: true, claims };
}
