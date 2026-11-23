// Who may start a build as a given userId. POST /api/projects/generate used to trust the userId in the body, so anyone who knew
// a user id could start builds as that user. This gate is rolled out in three steps behind GENERATE_AUTH_MODE:
//   off      nothing happens (no lookup, no counting)
//   report   (default) behaviour is unchanged for every request; each request is classified and counted, without PII
//   enforce  401 unless the caller proves the user: a valid access token for the SAME user, or a valid internal signature
// See docs/security-generate-auth.md.
import { verifiedUserId } from './verifiedUser.js';
import { checkInternalAuth } from './internalAuth.js';
import { sourceFromRequest } from './appEvents.js';

export const MODES = ['off', 'report', 'enforce'];
let warnedBadMode = false;

/** Unset or unrecognised -> 'report' (never silently 'enforce' or 'off'). */
export function generateAuthMode(env = process.env) {
    const raw = String(env.GENERATE_AUTH_MODE ?? '').trim().toLowerCase();
    if (!raw) return 'report';
    if (MODES.includes(raw)) return raw;
    if (!warnedBadMode) { warnedBadMode = true; console.warn('[generate-auth] unknown GENERATE_AUTH_MODE, using report'); }
    return 'report';
}

// Outcomes, in the order they are decided. would_block is what enforce mode would refuse.
export const OUTCOMES = {
    internal_ok: { allow: true },        // valid internal signature for this user id
    token_match: { allow: true },        // valid token, same user as the body
    token_mismatch: { allow: false },    // valid token for a different user (or no usable body userId)
    token_invalid: { allow: false },     // a bearer token was sent but it does not verify (expired, forged, or the auth lookup failed)
    no_token: { allow: false },          // no bearer token at all
};

const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;
const PLATFORMS = new Set(['web', 'android', 'ios', 'api']);

/** Labels that are safe to store: bounded sets only. Client-supplied, so they describe what the caller claims, not proof. */
export function labelsFor(req) {
    const h = String(req?.headers?.['x-platform'] ?? '').trim().toLowerCase();
    const platform = PLATFORMS.has(h) ? h : sourceFromRequest(req);
    const v = String(req?.headers?.['x-app-version'] ?? '').trim();
    const version = !v ? 'none' : VERSION.test(v) ? v : 'invalid';
    return { platform: PLATFORMS.has(platform) ? platform : 'api', version };
}

/**
 * Classifies one request. Never reads the token or user id into the result.
 * @returns {Promise<{outcome:string, allow:boolean, forgedInternal:boolean, platform:string, version:string}>}
 */
export async function classifyGenerateRequest(req, userId, { verifyUser = verifiedUserId, internal = checkInternalAuth } = {}) {
    const labels = labelsFor(req);
    const internalState = internal(req, userId);
    const forgedInternal = internalState === 'invalid';
    if (internalState === 'valid') return { outcome: 'internal_ok', allow: true, forgedInternal, ...labels };
    const hasBearer = /^Bearer\s+\S/i.test(String(req?.headers?.authorization || ''));
    if (!hasBearer) return { outcome: 'no_token', allow: false, forgedInternal, ...labels };
    const verified = await verifyUser(req);
    let outcome = 'token_invalid';
    if (verified) outcome = typeof userId === 'string' && userId && verified === userId ? 'token_match' : 'token_mismatch';
    return { outcome, allow: OUTCOMES[outcome].allow, forgedInternal, ...labels };
}

/**
 * In-memory counters (per process: they reset on restart and each machine has its own) plus a log line at most once a minute per
 * outcome class. Stores only outcome, platform and version counts.
 */
export function createGenerateAuthStats({ now = () => Date.now(), log = console.log, maxVersions = 40, logEveryMs = 60_000 } = {}) {
    let since = now();
    const counts = new Map();         // `${outcome}|${platform}|${version}` -> n
    const versions = new Set();
    const lastLog = new Map();        // outcome -> { at, pending }
    let forgedInternal = 0;

    function record(mode, c) {
        let version = c.version;
        if (version !== 'none' && version !== 'invalid' && !versions.has(version)) {
            if (versions.size >= maxVersions) version = 'other'; else versions.add(version);
        }
        const key = `${c.outcome}|${c.platform}|${version}`;
        counts.set(key, (counts.get(key) || 0) + 1);
        if (c.forgedInternal) forgedInternal += 1;
        const st = lastLog.get(c.outcome) || { at: -Infinity, pending: 0 };
        st.pending += 1;
        if (now() - st.at >= logEveryMs) {
            const wouldBlock = !OUTCOMES[c.outcome].allow;
            try { log(`[generate-auth] mode=${mode} class=${c.outcome} would_block=${wouldBlock} platform=${c.platform} version=${version} count_since_last_log=${st.pending}`); } catch { /* logging never breaks a request */ }
            st.at = now(); st.pending = 0;
        }
        lastLog.set(c.outcome, st);
    }

    function snapshot() {
        const totals = {}; const byPlatform = {}; const byVersion = {}; const rows = [];
        let wouldBlock = 0; let total = 0;
        for (const [key, n] of counts) {
            const [outcome, platform, version] = key.split('|');
            rows.push({ outcome, platform, version, count: n });
            totals[outcome] = (totals[outcome] || 0) + n;
            (byPlatform[platform] ||= {})[outcome] = (byPlatform[platform][outcome] || 0) + n;
            (byVersion[version] ||= {})[outcome] = (byVersion[version][outcome] || 0) + n;
            total += n; if (!OUTCOMES[outcome].allow) wouldBlock += n;
        }
        rows.sort((a, b) => b.count - a.count);
        return { since: new Date(since).toISOString(), total, wouldBlock, forgedInternalHeader: forgedInternal, totals, byPlatform, byVersion, rows };
    }

    function reset() { counts.clear(); versions.clear(); lastLog.clear(); forgedInternal = 0; since = now(); }
    return { record, snapshot, reset };
}

export const generateAuthStats = createGenerateAuthStats();

/**
 * The gate. Call at the top of the generate handler. Returns true when it has already answered (401): the route must return.
 * report mode never answers and never waits for the lookup, so it adds no latency and cannot fail a request.
 */
export async function guardGenerate(req, res, userId, { env = process.env, stats = generateAuthStats, ...deps } = {}) {
    const mode = generateAuthMode(env);
    if (mode === 'off') return false;
    if (mode === 'report') {
        classifyGenerateRequest(req, userId, deps).then((c) => stats.record(mode, c)).catch(() => {});
        return false;
    }
    let c;
    try { c = await classifyGenerateRequest(req, userId, deps); } catch { c = { outcome: 'token_invalid', allow: false, forgedInternal: false, ...labelsFor(req) }; }
    stats.record(mode, c);
    if (c.allow) return false;
    res.status(401).json({ error: 'Sign in again to start a build.', code: 'auth_required' });
    return true;
}
