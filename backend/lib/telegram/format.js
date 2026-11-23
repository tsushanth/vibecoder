// Pure text helpers for the Telegram bot: HTML escaping (parse_mode HTML), length limits, progress bar.
import { STRINGS } from './strings.js';

export const TELEGRAM_MAX_TEXT = 4096;

export function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Control characters (except tab/newline) are never useful in a prompt or a title.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export function cleanText(s) { return String(s ?? '').replace(CONTROL, ' ').replace(/\r\n?/g, '\n').trim(); }

/** Cuts to at most `max` code points (never splits a surrogate pair), adding an ellipsis when cut. */
export function truncate(s, max) {
    const chars = Array.from(String(s ?? ''));
    return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/** Cuts an already-built HTML message to Telegram's limit without ending inside an entity or an open tag. */
export function clampMessage(html, max = TELEGRAM_MAX_TEXT) {
    if (html.length <= max) return html;
    let cut = html.slice(0, max - 6); // room for a closing tag and the ellipsis
    cut = cut.replace(/&[a-z#0-9]*$/i, '');             // a half entity
    cut = cut.replace(/<[^>]*$/, '');                   // a half tag
    const opens = (cut.match(/<(b|i|a|code)\b/g) || []).length;
    const closes = (cut.match(/<\/(b|i|a|code)>/g) || []).length;
    // The bot's own messages never nest tags, so closing the last open one is enough.
    if (opens > closes) { const last = [...cut.matchAll(/<(b|i|a|code)\b/g)].pop()[1]; cut += `</${last}>`; }
    return `${cut}…`;
}

/** Looks up a string for a language (English when the language or key is missing) and fills {placeholders} with escaped values. */
export function t(lang, key, vars = {}) {
    const table = STRINGS[lang] || STRINGS.en;
    const raw = table[key] ?? STRINGS.en[key] ?? key;
    return escapeHtml(raw).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? escapeHtml(vars[name]) : m));
}

/** Plain (non-escaped) lookup, for button labels (Telegram does not parse markup there). */
export function tPlain(lang, key) {
    return (STRINGS[lang] || STRINGS.en)[key] ?? STRINGS.en[key] ?? key;
}

export function progressBar(percent, width = 10) {
    const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    const filled = Math.round((p / 100) * width);
    return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)} ${p}%`;
}

// Telegram language_code values that are not a bare primary tag in our list.
const CODE_ALIASES = { in: 'id', fil: 'tl', iw: 'en', nb: 'en', no: 'en' };
const SUPPORTED = new Set(Object.keys(STRINGS));
/** Maps Telegram's IETF language_code (e.g. "pt-br", "zh-hans", "uk") to one of our languages; English when unknown. */
export function languageFromCode(code) {
    if (typeof code !== 'string' || !code) return 'en';
    const primary = code.trim().toLowerCase().split(/[-_]/)[0];
    const tag = CODE_ALIASES[primary] || primary;
    return SUPPORTED.has(tag) ? tag : 'en';
}
