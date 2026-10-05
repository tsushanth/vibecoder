// Integration of the vibe.js SDK (vibe.api / vibe.ai, served by the platform proxy) into direct generation.
// Everything here is inert unless the proxy is enabled (VIBE_PROXY_ENABLED), because apps must not be told to call a proxy that is not live.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWN_CONNECTORS, MANIFEST_FILE, declaredCatalog, parseManifestFile, rawConnectorNames } from './connectors.js';
import { SCHEMA_FILE, normalisedSchema, schemaProblems } from './dataschema.js';
import { JOBS_FILE, jobConnectorNames, jobsProblems, normalisedJobs } from './jobsfile.js';
import { notifyProblems, payProblems } from './paynotify.js';

// Built-in connector names the proxy offers every app (see platform/vibe-proxy/builtins.js). Keep in sync (lib/connectors.js).
export { KNOWN_CONNECTORS };

const isVibeSdkFile = (p) => path.basename(p) === 'vibe.js';
const TEXT_FILE = /\.(html?|js|mjs)$/i;
const BACKEND_USES = /\bvibe\.(?:auth|db|storage|pay|notify)\b/;
const USES = /\bvibe\.(?:api|ai|auth|db|storage|pay|notify)\b/;

export function loadVibeSdk() {
    try { return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'vibe.js'), 'utf8'); } catch { return null; }
}

export function usesVibe(files) {
    return Object.entries(files).some(([p, c]) => TEXT_FILE.test(p) && !isVibeSdkFile(p) && USES.test(c));
}

/** True when the app uses the parts of the SDK that need a signed-in user or stored data (accounts, tables, uploads). */
export function usesBackendSdk(files) {
    return Object.entries(files).some(([p, c]) => TEXT_FILE.test(p) && !isVibeSdkFile(p) && BACKEND_USES.test(c));
}

/** Problems the fix pass can act on. Empty for apps that do not use vibe and carry no manifest. */
export function vibeProblems(files, { enabled }) {
    const manifestPaths = Object.keys(files).filter((p) => path.basename(p) === MANIFEST_FILE);
    const schemaPaths = Object.keys(files).filter((p) => path.basename(p) === SCHEMA_FILE);
    const jobsPaths = Object.keys(files).filter((p) => path.basename(p) === JOBS_FILE);
    const uses = usesVibe(files);
    if (!uses && !manifestPaths.length && !schemaPaths.length && !jobsPaths.length) return [];
    const problems = [];
    if (!enabled) {
        if (uses) problems.push('the vibe SDK (vibe.api, vibe.ai, vibe.auth, vibe.db, vibe.storage, vibe.pay, vibe.notify) is not available here: remove every vibe call and make the app work without it (keep data in localStorage)');
        if (schemaPaths.length) problems.push(`${SCHEMA_FILE} is not available here: do not write it, and keep the app's data in localStorage`);
        if (manifestPaths.length) problems.push(`${MANIFEST_FILE} is not available here: do not write it, and make the app work without any connector or payment`);
        if (jobsPaths.length) problems.push(`${JOBS_FILE} is not available here: do not write it, and make the app work without scheduled jobs`);
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
    if (uses && !/<script\b[^>]*\bsrc\s*=\s*["']\.?\/?vibe\.js["']/i.test(html)) problems.push('the app uses the vibe SDK (vibe.api, vibe.ai, vibe.auth, vibe.db, vibe.storage, vibe.pay or vibe.notify) but index.html does not load it: add <script src="vibe.js"></script> before the code that uses it');
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
    for (const name of jobConnectorNames(files[JOBS_FILE])) called.add(name); // a connector only a scheduled job uses is still used
    for (const name of unknown) problems.push(`vibe.api connector "${name}" does not exist; the available connectors are: ${known.join(', ')} (a new third-party API must be declared in ${MANIFEST_FILE})`);
    if (nonLiteral) problems.push('the first argument of vibe.api must be a string literal connector name, for example vibe.api("nws", "/points/39.7,-97.1")');
    else for (const name of declared) if (!called.has(name)) problems.push(`${MANIFEST_FILE} declares connector "${name}" but the app never calls it with vibe.api: call it, or remove it from the manifest (declare only what the app uses)`);
    problems.push(...schemaProblems(files));
    problems.push(...payProblems(files, declaredCatalog(files)));
    problems.push(...notifyProblems(files));
    problems.push(...jobsProblems(files, declared));
    return problems;
}

/**
 * Returns a copy of files with the real vibe.js added when the app uses it, any model-written vibe.js removed, and the
 * connector manifest and table schema replaced by their validated, normalised forms (dropped when invalid, empty, misplaced or the proxy is off).
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
        if (path.basename(p) === JOBS_FILE) {
            const norm = p === JOBS_FILE && enabled ? normalisedJobs(files) : null;
            if (norm) out[p] = norm;
            continue;
        }
        if (path.basename(p) === SCHEMA_FILE) {
            const norm = p === SCHEMA_FILE && enabled ? normalisedSchema({ [SCHEMA_FILE]: c }) : null;
            if (norm) out[p] = norm;
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

## Accounts, saved data and file uploads (vibe.auth, vibe.db, vibe.storage)
These are platform calls like vibe.api and vibe.ai, so the no-external-APIs rule does not forbid them. Same script tag (<script src="vibe.js"></script>); same rules: no keys, no other network calls, the platform provides the server side.
WHEN TO USE THEM: only when the app's value depends on data that must follow a person across devices or be kept per person on a server (accounts, saved lists or records, notes, a personal tracker, a guestbook or shared board) or on uploaded files (photos, documents). WHEN NOT TO: a purely local app (a game, calculator, timer, converter, quiz, drawing tool, anything that works fully offline) stays local and must not ask anyone to sign in. localStorage stays the right place for single-user trivial state such as settings, a score, a draft or a theme. Never add accounts "just in case", and never hide a working app behind a sign-in.
- Accounts (magic link, no passwords): vibe.auth.signIn(email) returns a Promise of { ok: true } and emails a one-time link; the link reopens the app and the SDK completes the sign-in by itself (never read the vibe_login parameter yourself). vibe.auth.user() returns a Promise of { id, email } or null; vibe.auth.signOut() returns a Promise; vibe.auth.onChange(fn) calls fn(user or null) after sign-in or sign-out and returns an unsubscribe function; vibe.auth.ready is a Promise that settles once a sign-in link in the address bar has been handled.
  - On start: await vibe.auth.ready, then await vibe.auth.user(), then show either the signed-in app or the sign-in screen. Never read the user before ready settles (right after clicking a link the person would look signed out).
  - Always build the sign-in UI: an email input, a "Send sign-in link" button, a message such as "Check your email for the link" after signIn resolves, an error message if it rejects, a visible signed-in state with the email and a "Sign out" button. Re-render with vibe.auth.onChange.
- Tables: declare every table in a file named vibe.schema.json at the project root (an ordinary <file> block). Format:
{"version":1,"tables":{"todos":{"access":"owner","columns":{"title":{"type":"text","required":true},"done":{"type":"boolean","default":false},"due":{"type":"timestamp"}},"indexes":[["done"]]}}}
  - Table and column names: lowercase letters, digits and _, starting with a letter, at most 41 characters. Column types: text, integer, number, boolean, timestamp, json. A column may have required (true) and default (a plain value of its type; "now" for a timestamp; json columns have no default). At most 20 tables, 30 columns per table, 3 indexes per table (each index lists up to 3 declared columns).
  - access: "owner" (the DEFAULT: each signed-in person sees and changes only their own rows; use it unless the app needs sharing), "public_read" (anyone can read all rows, only the row's owner changes it: a public board or directory), "authenticated" (any signed-in person reads and writes all rows: a shared list; use sparingly), "private" (the browser has no access at all: do not use it for tables the app reads).
  - Every table already has id, user_id and created_at, filled in by the platform. NEVER declare them in the schema, NEVER put user_id, id or created_at in an inserted or updated row, and never try to enforce privacy yourself with user_id: the platform does that. Rows come back with those three fields included.
  - Declare only the tables and columns the app uses. Adding a column later is fine; renaming or dropping one is destructive and needs the creator's approval, so choose names carefully.
- vibe.db.from("table") (the table name must be a string literal that exists in vibe.schema.json). Every method returns a Promise:
  - .select({ where: [{ col, op, val }], order: [{ col, dir }], limit, offset, columns }) resolves to { rows: [...] } (rows is [] when empty; 50 rows by default, limit at most 100). Every key is optional. op is one of "eq", "neq", "lt", "lte", "gt", "gte", "like", "ilike", "in" (val is an array), "is_null" (words, not symbols: never "=" or ">"); conditions are ANDed, at most 10. dir is "asc" or "desc".
  - .insert(rowOrRows) takes one row object or an array of up to 50, and resolves to { rows, count } with the stored rows including their new id. Send every required column.
  - .update(set, where) changes the matching rows: set is a non-empty object of the columns to change, where is a REQUIRED non-empty list of { col, op, val } filters, for example [{ col: "id", op: "eq", val: id }]; it resolves to { rows, count }.
  - .delete(where) removes the matching rows (where is REQUIRED and non-empty) and resolves to { rows, count }.
  Read result.rows to update the screen. Order by "created_at" for newest first, and keep results small with limit.
- Uploads: vibe.storage.upload(file) takes a File from <input type="file"> and resolves to { id, name, contentType, bytes }; vibe.storage.list() resolves to an array of those records; vibe.storage.url(id) resolves to a temporary URL to use as the src of an <img> or the href of a link; vibe.storage.remove(id) deletes the file. Allowed types: PNG, JPEG, GIF, WebP, PDF, MP3 and plain text (not SVG, not HTML, not video); maximum 5 MB. Check file.type and file.size in the app first and tell the person why a file is refused. Keep the file id in a table column if a row refers to a file.
- ERRORS: every call can fail. Catch every rejection and show a friendly message, and keep the rest of the app usable. err.status 401 means the session ended or the person is signed out: show the sign-in screen again instead of an error. 429 means slow down (err.retryAfter seconds), 413 or 415 means the file is too big or not allowed, 0 means offline.
- An app that uses vibe.db or vibe.storage MUST also use vibe.auth, because those only work for a signed-in person: load or save only after vibe.auth.user() returned a user. Provide an empty state ("Nothing here yet") and a loading state.
- A schema file without any vibe.db call, a vibe.db call to a table or column that is not in the schema, and a vibe.db or vibe.storage call in an app without vibe.auth are errors that will be sent back to you.

## Payments (vibe.pay)
Same script tag (<script src="vibe.js"></script>) and the same rules: no keys in the code, no other network calls. WHEN TO USE: only when the creator asks to sell something (a product, a ticket, a paid plan, a tip jar). Payments go through Stripe Checkout on the creator's OWN Stripe account; the platform and the page never see card data. Otherwise do not use vibe.pay and do not write a pay section.
- Declare what is for sale in vibe.manifest.json, the same file as connectors (it may hold connectors, pay, or both). Format:
{"pay":{"catalog":[{"id":"tee","name":"T-shirt","amountCents":2500,"currency":"usd","mode":"payment","maxQuantity":5},{"id":"pro","name":"Pro plan","amountCents":900,"currency":"usd","mode":"subscription","interval":"month"}]}}
  - id: lowercase letters, digits, - and _, starting with a letter, at most 32. name: 1 to 100 printable characters. amountCents: a whole number from 50 to 99999999 (2500 means 25.00). currency: usd, eur, gbp, cad, aud or inr. mode: "payment" (one-off) or "subscription"; a subscription needs interval (day, week, month or year) and a payment must not have one. maxQuantity (optional, 1 to 100, default 1): the most a buyer can take in one checkout. At most 20 items, no other fields. Use the prices the creator asked for; if none were given, pick plausible ones.
- vibe.pay.checkout({ item: "tee", quantity: 1 }) returns a Promise and sends the browser to the Stripe checkout page (it resolves { url, mode } just before). Pass ONLY item (the id of a catalog entry, exactly as written in vibe.manifest.json) and optionally quantity (a whole number up to the item's maxQuantity). NEVER send a price, amount, currency or product name from the browser, never compute a total for Stripe: the platform reads all of that from the catalog on the server. You may show prices in the page, taken from the same numbers as the catalog. Optional: successPath and cancelPath (paths on the app such as "/thanks"), redirect: false.
- After paying, the buyer returns to the app with ?vibe_pay=success&session_id=... (or ?vibe_pay=cancel) in the address bar: read it with URLSearchParams and show a thank-you or a "payment cancelled" message. Checkout works without signing in: do not force a sign-in to buy.
- vibe.pay.orders() resolves to the signed-in user's own paid orders [{ sessionId, itemId, quantity, amountCents, currency, status, createdAt }]. It needs vibe.auth (a signed-in person); use it only for a "my purchases" list. An order appears a moment after Stripe confirms the payment, so a new purchase may not be listed yet.
- The owner must add Stripe keys: the creator pastes their own Stripe secret key into the platform's key screen after the build (and a webhook signing secret to record orders); never write a key in any file and never ask a visitor for one. Until then checkout fails with err.code "stripe_key_missing" (err.status 424): show a clear message such as "The app owner still needs to add Stripe keys" and keep the rest of the app working. Also put a short visible note near the buy button, for example "Payments run in Stripe test mode until the owner adds live Stripe keys; the checkout opens on Stripe's own page."
- Other errors, all catchable: err.status 429 (err.code pay_rate_limited_ip, pay_rate_limited_hour or pay_daily_cap) means too many checkouts, try later (err.retryAfter seconds); 400 bad_quantity means the quantity is above maxQuantity; 404 payments_not_configured or unknown_item means the catalog and the code disagree (a bug: show a generic "this item is not available"); 502, 503 or 504 with a stripe_ code means Stripe is having trouble, try again; 0 means offline.
- NEVER ask for a card number, expiry date, security code or bank details in the page, and never add inputs for them: only the Stripe checkout page collects payment details. Say so ("You pay on Stripe's secure page").
- Not allowed with real money: gambling and betting, lotteries, adult content, weapons, binary options, trading signals, investment advice, and anything illegal. If the creator asks to sell or run any of these, do NOT write a pay section and do NOT use vibe.pay: build a free simulator or demo instead (play money, paper trading, sample data), clearly labelled "demo only, no real money, not financial advice", and say in the page that it is a demo. Ordinary goods, tickets, services, subscriptions and donations are fine.
- A pay catalog without any vibe.pay.checkout call, a checkout item that is not in the catalog, a price or amount sent to vibe.pay.checkout, a quantity above maxQuantity, vibe.pay.orders without vibe.auth, vibe.pay without a pay catalog and a card-number input are errors that will be sent back to you.

## Email to the signed-in user (vibe.notify)
Same script tag and rules. WHEN TO USE: only when the person wants a message sent to THEMSELF: a reminder, a receipt, a summary of what they just did, an exported list. Never add it "just in case".
- vibe.notify.me({ subject, text }) returns a Promise of { ok: true }. It only ever emails the signed-in user themself, at their own address: there is no way to name a recipient, so never pass to, email, recipient, cc or bcc (they are errors). subject is at most 120 characters and text at most 2000 characters, both plain text (no HTML) and not empty.
- It requires vibe.auth: build the sign-in UI described above and call vibe.notify.me only after vibe.auth.user() returned a user.
- It sends right now, when the person does something (a button); there is no "send later" and no scheduled email (notify jobs are not supported yet). For a reminder app, keep the reminders in the page and offer an "Email me this now" button; never promise an email at a set time.
- Never promise or imply delivery to anyone else (a friend, a customer, a team, the owner): no invite, share-by-email or "notify the buyer" flows. If the creator asks for that, build the in-app version without email and say plainly that the app cannot email other people. Delivery is best effort: write "We sent an email to your address", not "delivered".
- Errors: err.status 401 means the session ended: show the sign-in screen; 429 means slow down (err.retryAfter seconds); err.code "opted_out" (409) means the person turned off emails from this app: say so; 502 or 503 means try later. Catch every rejection.
- vibe.notify without vibe.auth, extra keys besides subject and text, and a literal subject over 120 or text over 2000 characters are errors that will be sent back to you.

## Scheduled jobs (vibe.jobs.json)
WHEN TO USE: only when the app needs data to keep being collected or tidied while nobody has it open: a periodic refresh of live data saved into a table (a weather logger, a rate history) or pruning old rows. Otherwise do not write the file. Jobs run on the platform, not in the page, so the page only reads what they saved.
- Write vibe.jobs.json at the project root (an ordinary <file> block). Format:
{"version":1,"jobs":[{"id":"hourly","schedule":{"every":"1h"},"action":{"type":"connector","connector":"nws","method":"GET","path":"/gridpoints/TOP/31,80/forecast","save":{"table":"readings","map":{"temp":"/properties/periods/0/temperature"}}}},{"id":"tidy","schedule":{"dailyAt":"03:30"},"action":{"type":"prune","table":"readings","olderThanDays":30}}]}
  - At most 5 jobs. id: lowercase letters, digits, - and _, starting with a letter, unique. schedule: {"every":"15m"}, "1h", "6h" or "1d", or {"dailyAt":"HH:MM"} in UTC. Choose the slowest schedule that serves the app (hourly is plenty for weather).
  - "type":"connector": connector is "nws" or one declared in vibe.manifest.json (and that is a real use of it); method "GET"; path is fixed text starting with / without ? or # (put parameters in "query": an object of strings, numbers or booleans). A job cannot look anything up: write the fixed coordinates or ids into the file (for nws, grid ids such as TOP/31,80, which you must be sure of). save.table must be declared in vibe.schema.json; save.map maps a column name to a JSON pointer into the response (such as "/properties/periods/0/temperature"), 1 to 30 columns, every required column without a default must be mapped and every column you map must be declared in the schema; never map id, user_id or created_at. Each run adds one row.
  - "type":"prune": deletes the rows of a table older than olderThanDays (1 to 365). Use it with a refresh job so the table does not grow forever.
  - notify jobs are not supported yet (error not_yet): never write a job of type "notify", and never use jobs to send email.
- The app reads the saved rows like any table: declare the table in vibe.schema.json and use vibe.db.from("readings").select({ order: [{ col: "created_at", dir: "desc" }], limit: 24 }) (with vibe.auth as above, since vibe.db needs a signed-in person). Rows written by a job have no user_id, so that table must have access "public_read" or "authenticated", never "owner" (nobody could read rows that have no owner).
- The data is not real time: show "Last updated" from created_at, and an empty state ("No readings yet, the first one arrives within the hour") instead of an error.
- A jobs file that does not validate, a job saving into a table or column missing from vibe.schema.json, a job using a connector that does not exist, and a job table with access "owner" are errors that will be sent back to you.
`;

export const withVibeRules = (rules, enabled) => (enabled ? `${rules}\n${VIBE_RULES}` : rules);
