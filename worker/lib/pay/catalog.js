// The creator-defined product catalog an app may sell. Untrusted input: validated strictly, unknown fields are rejected.
export const MAX_ITEMS = 20;
export const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud', 'inr'];
export const INTERVALS = ['day', 'week', 'month', 'year'];
export const MIN_AMOUNT = 50;
export const MAX_AMOUNT = 99_999_999;
export const MAX_QUANTITY = 100;
const ID = /^[a-z][a-z0-9_-]{0,31}$/;
const FIELDS = new Set(['id', 'name', 'amountCents', 'currency', 'mode', 'interval', 'maxQuantity']);

export function validateCatalog(list) {
    const problems = [];
    if (!Array.isArray(list)) return { ok: false, problems: ['catalog must be an array'] };
    if (!list.length) return { ok: false, problems: ['catalog needs at least one item'] };
    if (list.length > MAX_ITEMS) problems.push(`too many catalog items (max ${MAX_ITEMS})`);
    const seen = new Set();
    for (const it of list.slice(0, MAX_ITEMS + 1)) {
        if (!it || typeof it !== 'object' || Array.isArray(it)) { problems.push('catalog item must be an object'); continue; }
        const at = `item "${String(it.id).slice(0, 40)}"`;
        if (typeof it.id !== 'string' || !ID.test(it.id)) problems.push(`${at}: invalid id (lowercase letters, digits, - and _, max 32)`);
        else if (seen.has(it.id)) problems.push(`${at}: duplicate id`);
        else seen.add(it.id);
        for (const k of Object.keys(it)) if (!FIELDS.has(k)) problems.push(`${at}: unknown field "${k.slice(0, 40)}"`);
        if (typeof it.name !== 'string' || !it.name.trim() || it.name.length > 100 || /[\u0000-\u001f\u007f]/.test(it.name)) problems.push(`${at}: name must be 1 to 100 printable characters`);
        if (!Number.isInteger(it.amountCents) || it.amountCents < MIN_AMOUNT || it.amountCents > MAX_AMOUNT) problems.push(`${at}: amountCents must be an integer from ${MIN_AMOUNT} to ${MAX_AMOUNT}`);
        if (!CURRENCIES.includes(it.currency)) problems.push(`${at}: currency must be one of ${CURRENCIES.join(', ')}`);
        if (it.mode !== 'payment' && it.mode !== 'subscription') problems.push(`${at}: mode must be payment or subscription`);
        else if (it.mode === 'subscription' && !INTERVALS.includes(it.interval)) problems.push(`${at}: a subscription needs interval ${INTERVALS.join(', ')}`);
        else if (it.mode === 'payment' && it.interval !== undefined) problems.push(`${at}: interval is only for subscriptions`);
        if (it.maxQuantity !== undefined && (!Number.isInteger(it.maxQuantity) || it.maxQuantity < 1 || it.maxQuantity > MAX_QUANTITY)) problems.push(`${at}: maxQuantity must be an integer from 1 to ${MAX_QUANTITY}`);
    }
    return { ok: problems.length === 0, problems };
}

export function validatePay(pay) {
    if (!pay || typeof pay !== 'object' || Array.isArray(pay)) return { ok: false, problems: ['pay must be an object with a catalog'] };
    const problems = Object.keys(pay).filter((k) => k !== 'catalog').map((k) => `unknown field "${k.slice(0, 40)}"`);
    const c = validateCatalog(pay.catalog);
    return { ok: !problems.length && c.ok, problems: [...problems, ...c.problems] };
}
