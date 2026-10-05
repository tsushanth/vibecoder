// Static checks for vibe.pay (Stripe checkout with the creator's keys) and vibe.notify (email to the signed-in user) in generated code.
// A small scanner like lib/dataschema.js uses for vibe.db: it understands strings and brackets, not JavaScript, and only judges what it
// can read literally. Problem texts name only ids and keys that look like names, never other model-written content.
import { matching, splitArgs } from './dataschema.js';
import { MANIFEST_FILE } from './connectors.js';

const TEXT_FILE = /\.(html?|js|mjs)$/i;
const isSdk = (p) => p.split('/').pop() === 'vibe.js';
const NAME_SHAPE = /^[A-Za-z0-9_$-]{1,41}$/;
const safe = (n) => (NAME_SHAPE.test(String(n)) ? String(n) : '(invalid name)');
const CHECKOUT_KEYS = ['item', 'quantity', 'successPath', 'cancelPath', 'redirect'];
const NOTIFY_KEYS = ['subject', 'text'];
export const MAX_SUBJECT = 120;
export const MAX_TEXT = 2000;
const CARD_INPUT = /<input\b[^>]*?(?:autocomplete\s*=\s*["']?cc-|\b(?:name|id|placeholder|aria-label)\s*=\s*["'][^"']*(?:card[\s_-]*(?:number|no\b|num\b)|cvv|cvc|security[\s_-]*code|expir)[^"']*["'])/i;

const codeFiles = (files) => Object.entries(files).filter(([p, c]) => TEXT_FILE.test(p) && !isSdk(p) && typeof c === 'string');

/** Every call of `fn(` in the app's code: the text of its first argument, or null when it has none. */
function callsOf(files, re) {
    const out = [];
    for (const [, c] of codeFiles(files)) {
        for (const m of c.matchAll(re)) {
            const open = m.index + m[0].length - 1;
            const close = matching(c, open);
            const args = splitArgs(close < 0 ? c.slice(open + 1) : c.slice(open + 1, close));
            out.push(args[0] ?? null);
        }
    }
    return out;
}

/** The entries of an object literal argument: { entries: [{ key, value }], spread }, or null when it is not an object literal. */
function objectLiteral(arg) {
    if (typeof arg !== 'string' || !arg.startsWith('{') || matching(arg, 0) !== arg.length - 1) return null;
    const entries = [];
    let spread = false;
    for (const part of splitArgs(arg.slice(1, -1))) {
        const m = /^(?:([A-Za-z_$][\w$]*)|(["'])([^"']*)\2)\s*(?::([\s\S]*))?$/.exec(part);
        if (m) entries.push({ key: m[1] || m[3], value: m[4] === undefined ? undefined : m[4].trim() });
        else spread = true;
    }
    return { entries, spread };
}

const stringLiteral = (v) => { const m = typeof v === 'string' ? /^(["'`])((?:[^"'`\\$]|\\.)*)\1$/.exec(v) : null; return m ? m[2] : null; };
const wholeNumber = (v) => (typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : null);
const uses = (files, re) => codeFiles(files).some(([, c]) => re.test(c));

/** catalog: { state: 'none' | 'invalid' | 'ok', catalog: [...] } from connectors.declaredCatalog. */
export function payProblems(files, { state, catalog }) {
    const usesPay = uses(files, /\bvibe\.pay\b/);
    const checkouts = callsOf(files, /\bvibe\.pay\s*\.\s*checkout\s*\(/g);
    const problems = [];
    const once = (msg) => { if (!problems.includes(msg)) problems.push(msg); };
    if (!usesPay && state !== 'ok') return problems;
    if (state === 'none') once(`the app uses vibe.pay but ${MANIFEST_FILE} has no pay catalog: declare what is for sale as {"pay":{"catalog":[{"id":"...","name":"...","amountCents":1200,"currency":"usd","mode":"payment"}]}}`);
    if (state === 'ok' && !checkouts.length) once(`${MANIFEST_FILE} declares a pay catalog but the app never calls vibe.pay.checkout: add a buy button that calls vibe.pay.checkout({ item: "<catalog id>" }), or remove the pay section`);
    if (uses(files, /\bvibe\.pay\s*\.\s*orders\b/) && !uses(files, /\bvibe\.auth\b/)) once('the app uses vibe.pay.orders, which only works for a signed-in user, but never uses vibe.auth: add a sign-in form or remove the orders list');
    if (codeFiles(files).some(([, c]) => CARD_INPUT.test(c))) once('never ask for a card number, expiry or security code in the page: Stripe\'s own checkout page collects card details, so remove those inputs and call vibe.pay.checkout instead');
    if (state !== 'ok') return problems;

    const ids = catalog.map((i) => i.id);
    let dynamic = false;
    for (const arg of checkouts) {
        const obj = objectLiteral(arg);
        if (!obj) { dynamic = true; continue; }
        for (const { key } of obj.entries) if (!CHECKOUT_KEYS.includes(key)) once(`vibe.pay.checkout takes only item and quantity (plus successPath, cancelPath and redirect): remove "${safe(key)}". The price, currency and name always come from the catalog in ${MANIFEST_FILE} on the server, never from the browser`);
        const item = obj.entries.find((e) => e.key === 'item');
        if (!item && !obj.spread) { once('vibe.pay.checkout needs an item: vibe.pay.checkout({ item: "<catalog id>" })'); continue; }
        const id = item ? stringLiteral(item.value) : null;
        if (id === null) { dynamic = true; continue; }
        const entry = catalog.find((i) => i.id === id);
        if (!entry) { once(`vibe.pay.checkout item "${safe(id)}" is not in the catalog in ${MANIFEST_FILE} (catalog ids: ${ids.join(', ')}): use one of those ids or add the item to the catalog`); continue; }
        const q = obj.entries.find((e) => e.key === 'quantity');
        const n = q ? wholeNumber(q.value) : null;
        const max = entry.maxQuantity ?? 1;
        if (n !== null && n > max) once(`vibe.pay.checkout quantity ${n} for item "${entry.id}" is more than the catalog allows (at most ${max}): raise maxQuantity on that catalog item or lower the quantity`);
    }
    if (dynamic) {
        for (const id of ids) {
            const re = new RegExp(`["'\`]${id}["'\`]`); // catalog ids are [a-z0-9_-] only (validated), nothing to escape
            if (!uses(files, re)) once(`catalog item "${id}" is never referenced in the app's code: show it to the buyer and pass its id as a string to vibe.pay.checkout({ item }), or remove it from the catalog`);
        }
    }
    return problems;
}

export function notifyProblems(files) {
    if (!uses(files, /\bvibe\.notify\b/)) return [];
    const problems = [];
    const once = (msg) => { if (!problems.includes(msg)) problems.push(msg); };
    if (!uses(files, /\bvibe\.auth\b/)) once('the app uses vibe.notify, which emails the signed-in user only, but never uses vibe.auth: add a sign-in form (vibe.auth.signIn(email)) and call vibe.notify.me only for a signed-in user');
    for (const arg of callsOf(files, /\bvibe\.notify\s*\.\s*me\s*\(/g)) {
        const obj = objectLiteral(arg);
        if (!obj) continue;
        for (const { key } of obj.entries) if (!NOTIFY_KEYS.includes(key)) once(`vibe.notify.me takes only subject and text: remove "${safe(key)}". It emails the signed-in user at their own address and there is no way to name a recipient`);
        for (const [key, max] of [['subject', MAX_SUBJECT], ['text', MAX_TEXT]]) {
            const e = obj.entries.find((x) => x.key === key);
            const lit = e ? stringLiteral(e.value) : null;
            if (lit === null) continue;
            if (!lit.trim()) once(`vibe.notify.me ${key} must not be empty`);
            else if (lit.length > max) once(`vibe.notify.me ${key} is longer than ${max} characters: shorten it`);
        }
    }
    return problems;
}
