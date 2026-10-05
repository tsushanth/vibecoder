// Integration of the vibe.js SDK (vibe.api / vibe.ai, served by the platform proxy) into direct generation.
// Everything here is inert unless the proxy is enabled (VIBE_PROXY_ENABLED), because apps must not be told to call a proxy that is not live.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWN_CONNECTORS, MANIFEST_FILE, parseManifestFile, rawConnectorNames } from './connectors.js';

// Built-in connector names the proxy offers every app (see platform/vibe-proxy/builtins.js). Keep in sync (lib/connectors.js).
export { KNOWN_CONNECTORS };

const isVibeSdkFile = (p) => path.basename(p) === 'vibe.js';
const TEXT_FILE = /\.(html?|js|mjs)$/i;
const USES = /\bvibe\.(?:api|ai)\b/;

export function loadVibeSdk() {
    try { return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'vibe.js'), 'utf8'); } catch { return null; }
}

export function usesVibe(files) {
    return Object.entries(files).some(([p, c]) => TEXT_FILE.test(p) && !isVibeSdkFile(p) && USES.test(c));
}

/** Problems the fix pass can act on. Empty for apps that do not use vibe and carry no manifest. */
export function vibeProblems(files, { enabled }) {
    const manifestPaths = Object.keys(files).filter((p) => path.basename(p) === MANIFEST_FILE);
    const uses = usesVibe(files);
    if (!uses && !manifestPaths.length) return [];
    const problems = [];
    if (!enabled) {
        if (uses) problems.push('the vibe SDK (vibe.api, vibe.ai) is not available here: remove every vibe.api and vibe.ai call and make the app work without it');
        if (manifestPaths.length) problems.push(`${MANIFEST_FILE} is not available here: do not write it, and make the app work without any connector`);
        return problems;
    }
    for (const p of manifestPaths) if (p !== MANIFEST_FILE) problems.push(`${MANIFEST_FILE} must be at the project root, not at ${p.slice(0, 60)}`);
    let declared = [];
    const text = files[MANIFEST_FILE];
    if (typeof text === 'string') {
        const parsed = parseManifestFile(text);
        if (parsed.ok) declared = parsed.manifest ? Object.keys(parsed.manifest.connectors) : [];
        else {
            declared = rawConnectorNames(text);
            problems.push(`${MANIFEST_FILE} is invalid: ${parsed.problems.join('; ')}`);
        }
    }
    const html = files['index.html'] || '';
    if (uses && !/<script\b[^>]*\bsrc\s*=\s*["']\.?\/?vibe\.js["']/i.test(html)) problems.push('the app uses vibe.api or vibe.ai but index.html does not load it: add <script src="vibe.js"></script> before the code that uses it');
    const known = [...KNOWN_CONNECTORS, ...declared];
    const unknown = new Set();
    const called = new Set();
    let nonLiteral = false;
    for (const [p, c] of Object.entries(files)) {
        if (!TEXT_FILE.test(p) || isVibeSdkFile(p)) continue;
        for (const m of c.matchAll(/\bvibe\.api\s*\(\s*/g)) {
            const rest = c.slice(m.index + m[0].length);
            const lit = /^(["'`])([^"'`]*)\1/.exec(rest);
            if (!lit) nonLiteral = true;
            else { called.add(lit[2]); if (!known.includes(lit[2])) unknown.add(lit[2]); }
        }
    }
    for (const name of unknown) problems.push(`vibe.api connector "${name}" does not exist; the available connectors are: ${known.join(', ')} (a new third-party API must be declared in ${MANIFEST_FILE})`);
    if (nonLiteral) problems.push('the first argument of vibe.api must be a string literal connector name, for example vibe.api("nws", "/points/39.7,-97.1")');
    else for (const name of declared) if (!called.has(name)) problems.push(`${MANIFEST_FILE} declares connector "${name}" but the app never calls it with vibe.api: call it, or remove it from the manifest (declare only what the app uses)`);
    return problems;
}

/**
 * Returns a copy of files with the real vibe.js added when the app uses it, any model-written vibe.js removed, and the
 * connector manifest replaced by its validated, normalised form (dropped when invalid, empty, misplaced or the proxy is off).
 */
export function injectSdk(files, { sdk, enabled }) {
    const out = {};
    for (const [p, c] of Object.entries(files)) {
        if (isVibeSdkFile(p)) continue;
        if (path.basename(p) === MANIFEST_FILE) {
            if (p !== MANIFEST_FILE || !enabled) continue;
            const r = parseManifestFile(c);
            if (r.ok && r.manifest) out[p] = `${JSON.stringify(r.manifest, null, 2)}\n`;
            continue;
        }
        out[p] = c;
    }
    if (enabled && sdk && usesVibe(out)) out['vibe.js'] = sdk;
    return out;
}

export const VIBE_RULES = `
## Live data and AI without API keys (vibe.js)
This section overrides the earlier no-external-APIs rule for vibe.api and vibe.ai only; every other rule still applies.\nThe platform provides a small SDK. Use it ONLY when the app really needs live data or AI text generation; otherwise build the app fully offline as usual.
Load it first in index.html: <script src="vibe.js"></script> (do not write vibe.js yourself; the platform adds it).
- vibe.api(connector, path, { query }) returns a Promise of parsed JSON. The only connector is "nws" (US National Weather Service, United States locations only, needs latitude and longitude, no key):
  1. const point = await vibe.api("nws", "/points/" + lat + "," + lon); read point.properties.gridId, gridX and gridY.
  2. const fc = await vibe.api("nws", "/gridpoints/" + gridId + "/" + gridX + "," + gridY + "/forecast"); read fc.properties.periods.
  Also allowed: "/alerts/active" with query like { point: lat + "," + lon }. Offer preset cities with coordinates, or navigator.geolocation, because the app cannot look up a city name.
- vibe.ai.ask(prompt, { system }) returns a Promise of the reply text. vibe.ai.chat(messages, { maxTokens, temperature }) takes [{ role: "user" | "assistant" | "system", content }] and returns { text, usage }. Keep prompts short (under 8000 characters in total); replies are short. You cannot choose the model.
- Every call can fail. Always catch errors and show a friendly message: err.status 429 means slow down (err.retryAfter seconds), err.status 0 means offline or timed out, err.code names the reason. The rest of the app must keep working.
- Never ask the user for an API key and never put a key in the code. The platform adds keys on the server. No other network calls: no other fetch, no CDNs, no external scripts.
- A [SECRET:NAME] placeholder in the request means the creator stored that credential in the platform vault and the proxy injects it into upstream requests on the server. The app must never contain the value, and must not contain the placeholder text in its code either; never ask the user for the key. Only connectors that exist can use it, so do not invent a call that needs it.
- Third-party APIs that need a key (weather outside the US, stocks, news, maps and so on): use one ONLY when the app really needs live data that "nws" cannot give and you are sure of the API's real host and paths. Declare it in a file named vibe.manifest.json at the project root (an ordinary <file> block), then call it with vibe.api("<connector>", path, { query }) exactly like "nws". Example:
{"connectors":{"stocks":{"host":"api.example.com","paths":["/v1/quote*"],"methods":["GET"],"secret":{"name":"STOCKS_API_KEY","in":"query","field":"apikey"}}}}
  - host: the API's public hostname only (no https://, port, path or wildcard). paths: the allowed path prefixes, with a * only at the very end. methods: GET unless the API needs more. Keep both lists as small as the app needs.
  - secret: how the platform adds the creator's key. name is UPPER_SNAKE_CASE (if the request contains a placeholder like [SECRET:STOCKS_API_KEY], use exactly that name); "in" is "query" or "header"; field is the query parameter or header name the API expects, for example "apikey" or "X-Api-Key". Leave secret out for an API that needs no key. The creator pastes the key into the platform's key screen after the build, so never write a key into any file and never ask for it inside the app.
  - Connector names are lowercase letters, digits, - and _, never "nws". Declare only connectors the app calls, and at most 5.
  - Until the creator has entered the key, a keyed call fails with err.code "secret_missing" (err.status 424): show a clear message such as "The app owner still needs to add the API key" and keep the rest of the app working.
- Do not call any connector that is neither "nws" nor declared in vibe.manifest.json. If no real API fits, build a clearly labelled demo or simulator with built-in sample data instead.
`;

export const withVibeRules = (rules, enabled) => (enabled ? `${rules}\n${VIBE_RULES}` : rules);
