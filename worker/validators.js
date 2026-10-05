// Generated-app validators that need to be testable without booting server.js.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// The ONLY external origin generated apps may talk to: the VibeBuild per-app data API,
// reached through the inlined vibedata.js SDK.
export const VIBEBUILD_API_HOST = 'vibecoder-api.fly.dev';
const APPDATA_PATH_PREFIX = '/api/appdata/';

// assets/vibedata.js MUST be kept in sync with backend/public/vibedata.js.
const ASSET_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'vibedata.js');
export function readVibedataSdk() {
    try { return fs.readFileSync(ASSET_PATH, 'utf-8'); } catch { return null; }
}

// assets/vibe.js is the platform proxy SDK (vibe.api / vibe.ai). It is exempt only when byte-identical.
const VIBE_ASSET_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'vibe.js');
export function readVibeSdk() {
    try { return fs.readFileSync(VIBE_ASSET_PATH, 'utf-8'); } catch { return null; }
}

/** True only for https://vibecoder-api.fly.dev/api/appdata/... (exact host, no userinfo/port tricks). */
export function isAllowedApiUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { return false; }
    return u.protocol === 'https:' && u.hostname === VIBEBUILD_API_HOST
        && !u.username && !u.password && !u.port
        && u.pathname.startsWith(APPDATA_PATH_PREFIX);
}

/**
 * Check for external dependencies (CDN links, external URLs).
 * Exemptions (nothing else is relaxed):
 *  - vibedata.js and vibe.js when byte-identical to the bundled SDKs
 *  - src/href/fetch URLs that are exactly the VibeBuild appdata API
 */
export function checkExternalDeps(sources, sdkSource = readVibedataSdk(), vibeSdk = readVibeSdk()) {
    const issues = [];
    for (const [filePath, content] of Object.entries(sources)) {
        if (sdkSource && path.basename(filePath) === 'vibedata.js' && content === sdkSource) continue;
        if (vibeSdk && path.basename(filePath) === 'vibe.js' && content === vibeSdk) continue;
        const externalMatches = content.match(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi);
        if (externalMatches) {
            for (const match of externalMatches) {
                const url = match.replace(/^(?:src|href)\s*=\s*["']/i, '').replace(/["']$/, '');
                if (isAllowedApiUrl(url)) continue;
                issues.push({
                    severity: 'critical',
                    issue: `External URL in ${filePath}: ${match.substring(0, 80)}. All resources must be local.`
                });
            }
        }
        const fetchRe = /fetch\s*\(\s*["'](https?:\/\/[^"']*)/gi;
        let m;
        while ((m = fetchRe.exec(content)) !== null) {
            if (isAllowedApiUrl(m[1])) continue;
            issues.push({
                severity: 'critical',
                issue: `External fetch() call in ${filePath}. App must work offline.`
            });
            break;
        }
    }
    return issues;
}
