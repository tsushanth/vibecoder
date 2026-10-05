// SSRF guard: decides whether the proxy may fetch a URL. Web-standard APIs only (runs on Node and Deno).
// `resolve(hostname) -> Promise<string[]>` is injected so DNS can be faked in tests and real in the edge function.

const BLOCKED_SUFFIXES = ['.internal', '.local', '.localhost', '.lan', '.home', '.corp'];

function v4Parts(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (!m) return null;
    const p = m.slice(1).map(Number);
    return p.every((n) => n <= 255) ? p : null;
}

function privateV4([a, b]) {
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || a >= 224;
}

export function isPrivateAddress(raw) {
    const ip = String(raw).replace(/^\[|\]$/g, '').toLowerCase();
    const v4 = v4Parts(ip);
    if (v4) return privateV4(v4);
    if (!ip.includes(':')) return true; // not an address we understand: refuse
    if (ip === '::' || ip === '::1') return true;
    const mapped = /^::ffff:(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(ip);
    if (mapped) {
        if (mapped[1]) { const p = v4Parts(mapped[1]); return p ? privateV4(p) : true; }
        const hi = parseInt(mapped[2], 16), lo = parseInt(mapped[3], 16);
        return privateV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
    }
    const first = parseInt(ip.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00; // fc00::/7, fe80::/10, multicast
}

/** Returns { ok: true } or { ok: false, reason }. Never makes the request itself. */
export async function checkUrl(input, { resolve }) {
    let u;
    try { u = new URL(String(input)); } catch { return { ok: false, reason: 'unparseable url' }; }
    if (u.protocol !== 'https:') return { ok: false, reason: 'only https is allowed' };
    if (u.username || u.password) return { ok: false, reason: 'credentials in url are not allowed' };
    if (u.port && u.port !== '443') return { ok: false, reason: 'only port 443 is allowed' };
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: 'internal hostname' };
    // the URL parser has already normalised decimal, hex and octal forms to dotted quads
    if (v4Parts(host) || host.startsWith('[')) {
        return isPrivateAddress(host) ? { ok: false, reason: 'private or reserved address' } : { ok: true };
    }
    let addrs;
    try { addrs = await resolve(host); } catch { return { ok: false, reason: 'dns resolution failed' }; }
    if (!addrs?.length) return { ok: false, reason: 'hostname did not resolve' };
    if (addrs.some(isPrivateAddress)) return { ok: false, reason: 'resolves to a private or reserved address' };
    return { ok: true };
}
