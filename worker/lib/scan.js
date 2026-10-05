// Pre-publish scan of generated front-end files (hardcoded secrets, external or unverifiable requests), using the platform's
// scanner (vendored byte-for-byte in ./vendor, kept in sync by test/vendorDrift.test.mjs). Reports kind, file and line only:
// the scanner's free-text detail is dropped so nothing derived from the page content reaches a prompt, a log or a user.
import path from 'node:path';
import { scanFrontEnd } from './vendor/scanner.js';

// The proxy host every generated app may call (vibe.js talks to it). Keep in sync with platform/sdk/vibe.js.
export const PROXY_HOST = 'vibe-proxy.vibebuild.cc';
const APP_DOMAIN = 'vibebuild.cc';
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Files the platform adds itself; they legitimately talk to the proxy and are not model output.
const PLATFORM_FILES = new Set(['vibe.js', 'vibedata.js']);

/** What an app's manifest/connectors permit for now: the proxy host and the app's own preview domains (the only ones known at build time). */
export function allowedHostsFor(projectId) {
    const hosts = [PROXY_HOST];
    if (typeof projectId === 'string' && PROJECT_ID.test(projectId)) {
        hosts.push(`preview-${projectId.replace(/-/g, '').slice(0, 12)}.${APP_DOMAIN}`, `prev-${projectId.slice(0, 8)}.${APP_DOMAIN}`);
    }
    return hosts;
}

const GUIDANCE = {
    hardcoded_secret: 'remove the credential-shaped value from the code; never write a key into the app, the platform adds keys on the server',
    external_request: 'remove the request to an outside host; use only built-in data or vibe.api / vibe.ai',
    unverifiable_request: 'make the request target a plain string literal that points to a relative file or to vibe.api; do not build it at run time',
    private_request: 'remove the request to a local or private address',
    external_script: 'remove the externally loaded script; inline the code instead',
};

/** Returns { ok, findings: [{kind, file, line}], problems: [string] }. `problems` is what the fix pass is shown. */
export function scanGenerated(files, { allowedHosts = [PROXY_HOST] } = {}) {
    const own = {};
    for (const [p, c] of Object.entries(files || {})) if (!PLATFORM_FILES.has(path.basename(p))) own[p] = c;
    const { problems } = scanFrontEnd(own, { allowedHosts });
    const findings = problems.map(({ kind, file, line }) => ({ kind, file, line }));
    return {
        ok: findings.length === 0,
        findings,
        problems: findings.map((f) => `${f.kind} in ${f.file} line ${f.line}: ${GUIDANCE[f.kind] || 'remove it'}`),
    };
}

const SCAN_FAILED_MESSAGE = 'We could not finish this app safely: the code that was generated tried to include a secret key or contact an outside service. Please try again, and describe the idea so it works on its own without keys or outside services.';

/** User-safe text for a failed direct generation; `fallback` is used for causes that already have their own wording. */
export const userMessageForCause = (cause, fallback) => (cause === 'scan_failed' ? SCAN_FAILED_MESSAGE : fallback);
