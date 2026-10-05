// Integration of the vibe.js SDK (vibe.api / vibe.ai, served by the platform proxy) into direct generation.
// Everything here is inert unless the proxy is enabled (VIBE_PROXY_ENABLED), because apps must not be told to call a proxy that is not live.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Built-in connector names the proxy offers every app (see platform/vibe-proxy/builtins.js on the tier-1 branch). Keep in sync.
export const KNOWN_CONNECTORS = ['nws'];

const isVibeSdkFile = (p) => path.basename(p) === 'vibe.js';
const TEXT_FILE = /\.(html?|js|mjs)$/i;
const USES = /\bvibe\.(?:api|ai)\b/;

export function loadVibeSdk() {
    try { return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'vibe.js'), 'utf8'); } catch { return null; }
}

export function usesVibe(files) {
    return Object.entries(files).some(([p, c]) => TEXT_FILE.test(p) && !isVibeSdkFile(p) && USES.test(c));
}

/** Problems the fix pass can act on. Empty for apps that do not use vibe. */
export function vibeProblems(files, { enabled }) {
    if (!usesVibe(files)) return [];
    if (!enabled) return ['the vibe SDK (vibe.api, vibe.ai) is not available here: remove every vibe.api and vibe.ai call and make the app work without it'];
    const problems = [];
    const html = files['index.html'] || '';
    if (!/<script\b[^>]*\bsrc\s*=\s*["']\.?\/?vibe\.js["']/i.test(html)) problems.push('the app uses vibe.api or vibe.ai but index.html does not load it: add <script src="vibe.js"></script> before the code that uses it');
    const unknown = new Set();
    let nonLiteral = false;
    for (const [p, c] of Object.entries(files)) {
        if (!TEXT_FILE.test(p) || isVibeSdkFile(p)) continue;
        for (const m of c.matchAll(/\bvibe\.api\s*\(\s*/g)) {
            const rest = c.slice(m.index + m[0].length);
            const lit = /^(["'`])([^"'`]*)\1/.exec(rest);
            if (!lit) nonLiteral = true;
            else if (!KNOWN_CONNECTORS.includes(lit[2])) unknown.add(lit[2]);
        }
    }
    for (const name of unknown) problems.push(`vibe.api connector "${name}" does not exist; the only connectors are: ${KNOWN_CONNECTORS.join(', ')}`);
    if (nonLiteral) problems.push('the first argument of vibe.api must be a string literal connector name, for example vibe.api("nws", "/points/39.7,-97.1")');
    return problems;
}

/** Returns a copy of files with the real vibe.js added when the app uses it, and any model-written vibe.js removed. */
export function injectSdk(files, { sdk, enabled }) {
    const out = {};
    for (const [p, c] of Object.entries(files)) if (!isVibeSdkFile(p)) out[p] = c;
    if (enabled && sdk && usesVibe(out)) out['vibe.js'] = sdk;
    return out;
}

export const VIBE_RULES = `
## Live data and AI without API keys (vibe.js)
The platform provides a small SDK. Use it ONLY when the app really needs live data or AI text generation; otherwise build the app fully offline as usual.
Load it first in index.html: <script src="vibe.js"></script> (do not write vibe.js yourself; the platform adds it).
- vibe.api(connector, path, { query }) returns a Promise of parsed JSON. The only connector is "nws" (US National Weather Service, United States locations only, needs latitude and longitude, no key):
  1. const point = await vibe.api("nws", "/points/" + lat + "," + lon); read point.properties.gridId, gridX and gridY.
  2. const fc = await vibe.api("nws", "/gridpoints/" + gridId + "/" + gridX + "," + gridY + "/forecast"); read fc.properties.periods.
  Also allowed: "/alerts/active" with query like { point: lat + "," + lon }. Offer preset cities with coordinates, or navigator.geolocation, because the app cannot look up a city name.
- vibe.ai.ask(prompt, { system }) returns a Promise of the reply text. vibe.ai.chat(messages, { maxTokens, temperature }) takes [{ role: "user" | "assistant" | "system", content }] and returns { text, usage }. Keep prompts short (under 8000 characters in total); replies are short. You cannot choose the model.
- Every call can fail. Always catch errors and show a friendly message: err.status 429 means slow down (err.retryAfter seconds), err.status 0 means offline or timed out, err.code names the reason. The rest of the app must keep working.
- Never ask the user for an API key and never put a key in the code. The platform adds keys on the server. No other network calls: no other fetch, no CDNs, no external scripts.
- The only connector that exists is "nws". Do not invent other connectors (stocks, crypto, news, maps and so on); if the idea needs one, build a clearly labelled demo or simulator with built-in sample data instead.
`;

export const withVibeRules = (rules, enabled) => (enabled ? `${rules}\n${VIBE_RULES}` : rules);
