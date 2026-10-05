// Pre-publish scan of a generated app's front-end files. Blocks hardcoded secrets and requests the proxy cannot vouch for.
// Findings never include the secret value, only its kind, file and line.
import { isPrivateAddress } from './ssrf.js';

const SECRET_PATTERNS = [
    /AIza[0-9A-Za-z_-]{30,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/,
    /\bAKIA[0-9A-Z]{16}\b/, /\b[sr]k_live_[A-Za-z0-9]{16,}/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/, /\bAQ\.[A-Za-z0-9_-]{30,}/,
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /\bsb_secret_[A-Za-z0-9_-]{16,}/,
];
const KEYWORD_ASSIGN = /(?:api[_-]?key|secret|token|passwd|password|auth)\w*["']?\s*[:=]\s*(["'`])([A-Za-z0-9_\-+/=.]{24,})\1/i;
const REQUEST_CALLS = [
    { re: /\bfetch\s*\(\s*/g },
    { re: /\bnew\s+(?:WebSocket|EventSource)\s*\(\s*/g },
    { re: /\.open\s*\(\s*(?:["'`][A-Za-z]+["'`])\s*,\s*/g },
];
const lineAt = (text, i) => text.slice(0, i).split('\n').length;

function classify(url, allowedHosts) {
    if (/^\/(?!\/)/.test(url) || (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//'))) return null; // relative
    let u;
    try { u = new URL(url.startsWith('//') ? 'https:' + url : url.replace(/^(wss?):/i, 'https:')); } catch { return 'unverifiable_request'; }
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || ((/^[\d.]+$/.test(host) || host.includes(':')) && isPrivateAddress(host))) return 'private_request';
    return allowedHosts.includes(host) ? null : 'external_request';
}

export function scanFrontEnd(files, { allowedHosts = [] } = {}) {
    const problems = [];
    for (const [file, text] of Object.entries(files)) {
        if (!/\.(html?|js|mjs)$/i.test(file)) continue;
        const add = (kind, i, detail) => problems.push({ kind, file, line: lineAt(text, i), detail });
        for (const p of SECRET_PATTERNS) { const m = p.exec(text); if (m) add('hardcoded_secret', m.index, 'a credential-shaped value is written into the page'); }
        const k = KEYWORD_ASSIGN.exec(text);
        if (k && !problems.some((x) => x.file === file && x.kind === 'hardcoded_secret' && x.line === lineAt(text, k.index))) add('hardcoded_secret', k.index, 'a long literal is assigned to a key-like name');
        for (const { re } of REQUEST_CALLS) {
            for (const m of text.matchAll(re)) {
                const rest = text.slice(m.index + m[0].length);
                const lit = /^(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/.exec(rest);
                if (!lit) { add('unverifiable_request', m.index, 'request target is not a string literal'); continue; }
                const url = lit[2];
                if (url.startsWith('${')) { add('unverifiable_request', m.index, 'request target is built at run time'); continue; }
                const kind = classify(url.split('${')[0], allowedHosts);
                if (kind) add(kind, m.index, `request to ${url.slice(0, 60).replace(/[?#].*/, '')}`);
            }
        }
        for (const m of text.matchAll(/<script\b[^>]*\ssrc\s*=\s*["']?((?:https?:)?\/\/([^"'\s>/]+)[^"'\s>]*)/gi)) {
            if (!allowedHosts.includes(m[2].toLowerCase())) add('external_script', m.index, `script loaded from ${m[2]}`);
        }
    }
    return { ok: problems.length === 0, problems };
}
