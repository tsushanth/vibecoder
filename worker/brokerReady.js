// Readiness of the path every build actually uses: the Claude CLI wrapper (claude-multi) fetches a token from the
// central broker, and builds die instantly when the broker has none. The old cron check ran the real `claude` binary
// with its own credentials, so it stayed green while this path was down. This asks the broker for a token the same way
// the wrapper does and reports only whether it got one (the token itself is never returned or logged).
import * as fs from 'fs';

const DEFAULT_BROKER_URL = 'http://178.156.192.31:3460';
const SECRET_FILE = '/etc/claude-broker-secret';

/**
 * @returns {Promise<{ready: boolean, mode: 'broker'|'direct', status?: number, reason?: string}>}
 * `direct` means this machine has no broker secret (local development), so the broker is not part of the path.
 */
export async function checkBrokerReady({
    fetchImpl = fetch,
    readSecret = () => fs.readFileSync(process.env.CLAUDE_BROKER_SECRET_FILE || SECRET_FILE, 'utf-8'),
    brokerUrl = process.env.CLAUDE_BROKER_URL || DEFAULT_BROKER_URL,
    timeoutMs = 8000,
} = {}) {
    let secret;
    try {
        secret = readSecret().replace(/\s+/g, '');
    } catch (e) {
        if (e && e.code === 'ENOENT') return { ready: true, mode: 'direct' };
        return { ready: false, mode: 'broker', reason: `cannot read broker secret: ${e && e.code ? e.code : 'error'}` };
    }
    if (!secret) return { ready: false, mode: 'broker', reason: 'broker secret file is empty' };

    let res;
    try {
        res = await fetchImpl(`${brokerUrl}/token`, {
            headers: { Authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch {
        return { ready: false, mode: 'broker', reason: 'broker unreachable' };
    }
    if (res.ok) return { ready: true, mode: 'broker', status: res.status };

    let detail = '';
    try { detail = String((await res.json()).error || '').slice(0, 120); } catch { /* body is optional */ }
    return { ready: false, mode: 'broker', status: res.status, reason: detail || `broker returned ${res.status}` };
}
