// First-touch signup attribution: which channel a new account came from.
//
// The web app captures utm_* values, the referrer host and the landing path on a visitor's first visit and sends them with
// the signup as `signup_source`. This module validates that object and works out the platform. Everything here is
// descriptive analytics only: none of it may be used for authorization, billing or any other decision.

export const PLATFORMS = ['web', 'android', 'ios', 'unknown'];

// Body keys accepted inside `signup_source`, mapped to their users column. Anything else is dropped.
const KEY_TO_COLUMN = {
    utm_source: 'utm_source',
    utm_medium: 'utm_medium',
    utm_campaign: 'utm_campaign',
    utm_content: 'utm_content',
    referrer_host: 'referrer_host',
    landing_path: 'landing_path',
};

export const MAX_FIELD_LENGTH = 64;
const MAX_RAW_LENGTH = 512; // a field longer than this is not a real value; do not even try to trim it

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

function clean(value) {
    if (typeof value !== 'string' || value.length > MAX_RAW_LENGTH) return null;
    const v = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
    return v || null;
}

// utm values are free text chosen by whoever built the link. Email-campaign links sometimes carry the recipient's address,
// so a value that looks like an email address is dropped rather than stored.
function cleanUtm(value) {
    const v = clean(value);
    if (!v || v.includes('@')) return null;
    return v.slice(0, MAX_FIELD_LENGTH);
}

// A bare host name only: no scheme, port, path, query or credentials.
function cleanHost(value) {
    const v = clean(value);
    if (!v) return null;
    let host = v.toLowerCase();
    if (host.includes('://')) {
        try { host = new URL(host).hostname; } catch { return null; }
    }
    host = host.replace(/^www\./, '');
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes('.')) return null;
    return host.slice(0, MAX_FIELD_LENGTH);
}

// A path only. The query string and fragment are cut off because they can carry tokens or personal data.
function cleanPath(value) {
    const v = clean(value);
    if (!v || !v.startsWith('/') || v.startsWith('//')) return null;
    return v.split(/[?#]/)[0].slice(0, MAX_FIELD_LENGTH) || null;
}

/**
 * Validate the untrusted `signup_source` object from a request body.
 * Returns an object with only the known keys that held a usable string (never throws); {} when nothing is usable.
 */
export function sanitizeSignupSource(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const key of Object.keys(KEY_TO_COLUMN)) {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
        const v = key === 'referrer_host' ? cleanHost(raw[key]) : key === 'landing_path' ? cleanPath(raw[key]) : cleanUtm(raw[key]);
        if (v) out[key] = v;
    }
    return out;
}

/**
 * Which platform made the request that is creating the account.
 * An explicit `X-Client-Platform` header wins when it is one of web/android/ios (a native client can set it); otherwise the
 * user agent is used. Android's Retrofit/OkHttp and iOS's URLSession are recognised; a browser is 'web'.
 */
export function platformFromRequest(req) {
    const header = String(req?.headers?.['x-client-platform'] ?? '').trim().toLowerCase();
    if (header === 'web' || header === 'android' || header === 'ios') return header;
    const ua = String(req?.headers?.['user-agent'] ?? '');
    if (/okhttp|dalvik/i.test(ua)) return 'android';
    if (/cfnetwork|darwin/i.test(ua)) return 'ios';
    if (/^mozilla\//i.test(ua)) return 'web';
    return 'unknown';
}

/** The users-table columns to record for a new account, or null. Values here are always already sanitized. */
export function buildSignupSourceColumns(req, rawSignupSource, now = new Date()) {
    const src = sanitizeSignupSource(rawSignupSource);
    return {
        platform: platformFromRequest(req),
        ...src,
        signup_source_at: now.toISOString(),
    };
}

// Postgres 42703 = undefined_column. PostgREST answers PGRST204 when its schema cache has no such column.
export function isMissingColumnError(error) {
    if (!error) return false;
    if (error.code === '42703' || error.code === 'PGRST204') return true;
    return /column .* (does not exist|of relation)|could not find the '.*' column/i.test(String(error.message || ''));
}

let columnsMissingUntil = 0;
const RETRY_AFTER_MS = 60_000;

/**
 * Record first-touch attribution on a freshly created users row. Best effort and never throws: signup must not depend on
 * this. Written as a separate update (not part of the insert) so a database without the columns cannot fail the signup;
 * the `signup_source_at is null` guard means a row's first source is never overwritten.
 */
export async function recordSignupSource(supabase, userId, req, rawSignupSource, { now = new Date(), log = console } = {}) {
    if (Date.now() < columnsMissingUntil) return false; // migration not applied yet; skip until the next check
    try {
        const cols = buildSignupSourceColumns(req, rawSignupSource, now);
        const { error } = await supabase.from('users').update(cols).eq('user_id', userId).is('signup_source_at', null);
        if (!error) { columnsMissingUntil = 0; return true; }
        if (isMissingColumnError(error)) {
            columnsMissingUntil = Date.now() + RETRY_AFTER_MS;
            log.warn('[signup-source] users source columns are not in the database yet; skipping (apply the signup source migration)');
        } else {
            log.warn('[signup-source] could not record signup source:', error.message);
        }
    } catch (e) {
        log.warn('[signup-source] could not record signup source:', e?.message);
    }
    return false;
}

// Test hook: forget that the columns were missing.
export function resetSignupSourceCache() { columnsMissingUntil = 0; }
