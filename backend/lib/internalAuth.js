// Proof that a request comes from one of our own services (the in-process Telegram bot over loopback, the SMS/WhatsApp bot),
// not from the public internet. The caller signs "<timestamp>.<userId>" with a secret both sides already hold (WORKER_SECRET) and
// sends it as `x-internal-auth: v1.<unix seconds>.<hex hmac>`.
//
// Never decided by source IP or X-Forwarded-For: those can be forged or are the proxy's. Fails closed when the secret is unset or
// short. The signature covers the user id, so a captured header cannot be reused for another user, and it expires after 5 minutes.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const INTERNAL_AUTH_HEADER = 'x-internal-auth';
const MAX_SKEW_SECONDS = 300;
const MIN_SECRET_LENGTH = 16;
const FORMAT = /^v1\.(\d{1,12})\.([0-9a-f]{64})$/;

const usable = (secret) => typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
const mac = (secret, ts, userId) => createHmac('sha256', secret).update(`v1.${ts}.${userId}`).digest('hex');

/** The header value to send, or null when there is no usable secret or user id (the caller then sends no header). */
export function signInternalAuth(secret, userId, nowMs = Date.now()) {
    if (!usable(secret) || typeof userId !== 'string' || !userId) return null;
    const ts = Math.floor(nowMs / 1000);
    return `v1.${ts}.${mac(secret, ts, userId)}`;
}

/** @returns {'absent'|'valid'|'invalid'} 'invalid' covers malformed, expired, wrong signature and "no secret configured here". */
export function checkInternalAuth(req, userId, { secret = process.env.WORKER_SECRET, nowMs = Date.now() } = {}) {
    const raw = req?.headers?.[INTERNAL_AUTH_HEADER];
    if (raw === undefined || raw === '') return 'absent';
    if (!usable(secret) || typeof userId !== 'string' || !userId || typeof raw !== 'string') return 'invalid';
    const m = FORMAT.exec(raw);
    if (!m) return 'invalid';
    const ts = Number(m[1]);
    if (Math.abs(Math.floor(nowMs / 1000) - ts) > MAX_SKEW_SECONDS) return 'invalid';
    const given = Buffer.from(m[2], 'hex');
    const want = Buffer.from(mac(secret, ts, userId), 'hex');
    return given.length === want.length && timingSafeEqual(given, want) ? 'valid' : 'invalid';
}
