// Idea-suggestion localisation for the Create screen.
//
// The app sends its UI language as `lang` (a primary tag from the whitelist below). For anything other than English we
// translate the same suggestion items lazily and keep each result in memory per (language, item hash) so an item is
// translated at most once per process. Any failure returns the English item: this never errors and never blocks a build.
import { createHash } from 'node:crypto';
import { recordLlm as defaultRecordLlm } from './llmUsageInstance.js';

// The 26 UI languages the Android app ships. `id` is Indonesian (Android's legacy resource code is `in`), `zh` is
// Simplified Chinese, `pt` is Brazilian Portuguese.
export const SUPPORTED_LANGS = Object.freeze([
    'ar', 'cs', 'de', 'el', 'es', 'fi', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tl', 'tr', 'uk', 'vi', 'zh',
]);

const LANG_NAMES = Object.freeze({
    ar: 'Arabic', cs: 'Czech', de: 'German', el: 'Greek', es: 'Spanish', fi: 'Finnish', fr: 'French', hi: 'Hindi', hu: 'Hungarian',
    id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', ms: 'Malay', nl: 'Dutch', pl: 'Polish', pt: 'Brazilian Portuguese',
    ro: 'Romanian', ru: 'Russian', sv: 'Swedish', th: 'Thai', tl: 'Filipino (Tagalog)', tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese',
    zh: 'Simplified Chinese',
});

const ALIASES = { in: 'id', fil: 'tl' };

/** Maps whatever the client sent to a whitelisted primary tag, or 'en' (the default, also for anything unknown). */
export function normalizeLang(raw) {
    if (typeof raw !== 'string') return 'en';
    const primary = raw.trim().toLowerCase().split(/[-_]/)[0];
    const tag = ALIASES[primary] || primary;
    return SUPPORTED_LANGS.includes(tag) ? tag : 'en';
}

export function languageName(tag) { return LANG_NAMES[tag] || 'English'; }

// A reply can come back with a translated label but the prompt returned unchanged in English (seen live for zh: a Chinese
// chip that fills an English prompt, so the app it builds is English). Such an item counts as not translated: it is retried
// once, and if it stays English the whole item (label and prompt) is shown in English, never a mix.
export function looksTranslated(english, translated) {
    if (!translated || typeof translated.prompt !== 'string') return false;
    return translated.prompt.trim() !== String(english?.prompt ?? '').trim();
}

const hashOf = (s) => createHash('sha1').update(`${s.label}\u0000${s.prompt}`).digest('hex').slice(0, 16);
const BATCH_SIZE = 3;
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const MAX_LABEL = 80;
const MAX_PROMPT = 1200;
const oneLine = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const unescapeJson = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|["\\/nrt])/g, (_, c) => {
    if (c[0] === 'u') return String.fromCharCode(parseInt(c.slice(1), 16));
    return ({ n: ' ', r: ' ', t: ' ' })[c] ?? c;
});
const stripFences = (t) => String(t || '').replace(/```[a-zA-Z]*/g, '');

// Tier 1: the delimiter format we ask for. Free text can contain any quote or bracket without breaking it.
//   ===ITEM 0===\nlabel: ...\nprompt: ...\n===ITEM 1=== ...
function parseDelimited(text) {
    const re = /^[ \t]*={2,}[ \t]*ITEM[ \t]+(\d+)[ \t]*={2,}[ \t]*$/gim;
    const marks = [];
    let m;
    while ((m = re.exec(text))) marks.push({ i: Number(m[1]), start: m.index, end: m.index + m[0].length });
    const entries = [];
    marks.forEach((mk, k) => {
        let seg = text.slice(mk.end, k + 1 < marks.length ? marks[k + 1].start : text.length);
        seg = seg.replace(/^[ \t]*={2,}[ \t]*END[ \t]*={2,}[ \t]*$[\s\S]*/im, '');
        const lm = seg.match(/^[ \t]*label[ \t]*:[ \t]*(.*)$/im);
        const pm = seg.match(/^[ \t]*prompt[ \t]*:([\s\S]*)$/im);
        if (lm && pm) entries.push({ i: mk.i, label: oneLine(lm[1]), prompt: oneLine(pm[1]) });
        else entries.push({ i: mk.i, label: '', prompt: '' });
    });
    return entries;
}

// Tier 2: a well-formed JSON array (code fences stripped).
function parseJsonArray(text) {
    const m = stripFences(text).match(/\[[\s\S]*\]/);
    if (!m) return null;
    try {
        const arr = JSON.parse(m[0]);
        return Array.isArray(arr) ? arr.map((o) => ({ i: Number.isInteger(o?.i) ? o.i : undefined, label: oneLine(o?.label), prompt: oneLine(o?.prompt) })) : null;
    } catch { return null; }
}

// Tier 3: per-object salvage from broken JSON (unescaped quotes inside strings, truncation, stray commas). An object is only
// taken when its closing `"}` is present, so a truncated last object is dropped, never half-used.
function salvageJsonObjects(text) {
    const entries = [];
    const withIdx = /"i"\s*:\s*(\d+)\s*,\s*"label"\s*:\s*"([\s\S]*?)"\s*,\s*"prompt"\s*:\s*"([\s\S]*?)"\s*\}/g;
    let m;
    while ((m = withIdx.exec(text))) entries.push({ i: Number(m[1]), label: oneLine(unescapeJson(m[2])), prompt: oneLine(unescapeJson(m[3])) });
    if (entries.length) return entries;
    const noIdx = /"label"\s*:\s*"([\s\S]*?)"\s*,\s*"prompt"\s*:\s*"([\s\S]*?)"\s*\}/g;
    while ((m = noIdx.exec(text))) entries.push({ i: undefined, label: oneLine(unescapeJson(m[1])), prompt: oneLine(unescapeJson(m[2])) });
    return entries;
}

/**
 * Parses a model reply into `count` slots (null where an item is missing or unusable). Never throws.
 * Accepts the delimiter format, a JSON array, or broken/truncated JSON; extra or out-of-range items are ignored and the
 * first answer for an index wins. `truncated` (stop_reason max_tokens) drops the last delimiter item, which may be cut short.
 */
export function parseTranslations(text, count, { truncated = false } = {}) {
    const out = new Array(count).fill(null);
    try {
        const body = stripFences(text);
        let entries = parseDelimited(body);
        if (entries.length && truncated && !/^[ \t]*={2,}[ \t]*END[ \t]*={2,}/im.test(body)) entries = entries.slice(0, -1);
        if (!entries.length) entries = parseJsonArray(text) || [];
        if (!entries.length) entries = salvageJsonObjects(String(text || ''));
        entries.forEach((o, pos) => {
            const idx = Number.isInteger(o.i) ? o.i : (entries.length === count ? pos : -1); // no index: trust position only if the count matches
            const label = clean(o.label, MAX_LABEL);
            const prompt = clean(o.prompt, MAX_PROMPT);
            if (idx >= 0 && idx < count && label && prompt && !out[idx]) out[idx] = { label, prompt };
        });
    } catch { /* fall through with whatever was filled */ }
    return out;
}

/** Parses a list of generated ideas ({label, prompt}); tolerant of fences, unescaped quotes and truncation. Never throws. */
export function parseIdeaList(text, max = 6) {
    const arr = parseJsonArray(text) || salvageJsonObjects(String(text || ''));
    return arr.map((o) => ({ label: clean(o.label, MAX_LABEL), prompt: clean(o.prompt, MAX_PROMPT) })).filter((o) => o.label && o.prompt).slice(0, max);
}

export function createSuggestionTranslator({
    getApiKey = () => process.env.ANTHROPIC_API_KEY,
    fetchImpl = (...a) => globalThis.fetch(...a),
    recordLlm = defaultRecordLlm,
    now = () => Date.now(),
    timeoutMs = 10000,
    failureCooldownMs = 60000,
    maxCacheEntries = 5000,
    log = (m) => console.error(m),
} = {}) {
    const cache = new Map();      // `${lang}|${hash}` -> { label, prompt }
    const inflight = new Map();   // `${lang}|${hash}` -> Promise<{label,prompt}|null>
    const reverse = new Map();    // translated prompt -> english prompt (lets "mark suggestion used" still match)
    const failedAt = new Map();   // lang -> timestamp of last transport failure (HTTP error, network, timeout, no key)
    const unparsedAt = new Map(); // `${lang}|${hash}` -> timestamp the model reply for this item was unusable twice

    async function callModel(lang, items) {
        const key = getApiKey();
        if (!key) throw new Error('no api key');
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        let recorded = false;
        try {
            const payload = items.map((s, i) => `===ITEM ${i}===\nlabel: ${oneLine(s.label)}\nprompt: ${oneLine(s.prompt)}`).join('\n');
            const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                signal: ctl.signal,
                headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 4096,
                    messages: [{
                        role: 'user',
                        content: `Translate these app-idea suggestions into ${languageName(lang)}. Keep each "label" short (2-3 words) and natural for a button chip, and keep each "prompt" a faithful, fluent translation that preserves every feature and design direction. Keep brand names and proper nouns (for example Kanban, Pomodoro, Netflix, Spotify, Trello, Slack, Notion, WhatsApp, Instagram, Medium, Typeform, VS Code, PNG, PDF, HTML, CSS, JS, WPM) as they are. Do not add or remove anything. Write every label and prompt entirely in ${languageName(lang)}.\n\nInput:\n${payload}\n===END===\n\nOutput the same blocks in the same order, with the same "===ITEM n===" header lines (same numbers), each followed by one "label: ..." line and one "prompt: ..." line containing the translation, then a final "===END===" line. Plain text only: no JSON, no markdown, no code fences, no explanation. Quotes and brackets inside the text are fine as they are.`,
                    }],
                }),
            });
            if (!response.ok) {
                recorded = true;
                recordLlm({ model: 'claude-haiku-4-5', feature: 'suggestions_translate', ok: false });
                throw new Error(`Anthropic API error: ${response.status}`);
            }
            const data = await response.json();
            recorded = true;
            recordLlm({ model: data.model || 'claude-haiku-4-5', usage: data.usage, feature: 'suggestions_translate' });
            const text = (data.content || []).map((c) => c?.text || '').join('');
            const out = parseTranslations(text, items.length, { truncated: data.stop_reason === 'max_tokens' });
            return out;
        } catch (e) {
            if (!recorded) recordLlm({ model: 'claude-haiku-4-5', feature: 'suggestions_translate', ok: false });
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }

    // One upstream call, plus ONE retry for just the items the reply did not yield (bad format, dropped or truncated items).
    // Transport errors throw (cooldown); an unusable reply never throws: those items stay null and fall back to English.
    async function translateBatch(lang, items) {
        const keepTranslated = (out, src) => out.map((t, i) => (t && looksTranslated(src[i], t) ? t : null));
        let out = keepTranslated(await callModel(lang, items), items);
        const missing = out.flatMap((t, i) => (t ? [] : [i]));
        if (missing.length) {
            try {
                const retryItems = missing.map((i) => items[i]);
                const again = keepTranslated(await callModel(lang, retryItems), retryItems);
                missing.forEach((i, j) => { if (again[j]) out[i] = again[j]; });
            } catch (e) {
                log(`[suggestions-i18n] ${lang} retry failed: ${e.message}`);
            }
        }
        return out;
    }

    function remember(k, english, translated) {
        if (cache.size >= maxCacheEntries) {           // bounded: drop the oldest entry
            const oldest = cache.keys().next().value;
            cache.delete(oldest);
        }
        cache.set(k, translated);
        if (reverse.size < maxCacheEntries) reverse.set(translated.prompt, english.prompt);
    }

    /** Returns `items` translated into `lang` where possible; any item that cannot be translated stays English. Never throws. */
    async function localize(items, langRaw) {
        const lang = normalizeLang(langRaw);
        if (lang === 'en' || !Array.isArray(items) || items.length === 0) return items;
        try {
            const keys = items.map((s) => `${lang}|${hashOf(s)}`);
            const missing = [];
            const waits = [];
            items.forEach((s, i) => {
                if (cache.has(keys[i])) return;
                if (inflight.has(keys[i])) { waits.push(inflight.get(keys[i])); return; }
                if (unparsedAt.has(keys[i]) && now() - unparsedAt.get(keys[i]) < failureCooldownMs) return; // just failed twice: stay English for now
                missing.push(i);
            });
            const cooling = failedAt.has(lang) && now() - failedAt.get(lang) < failureCooldownMs;
            if (missing.length && !cooling) {
                // Small parallel batches: each finishes well inside the timeout even for scripts that cost many tokens
                // (Hindi, Thai, Arabic), and each batch is cached on its own so partial progress is kept.
                for (let at = 0; at < missing.length; at += BATCH_SIZE) {
                    const idxs = missing.slice(at, at + BATCH_SIZE);
                    const batch = idxs.map((i) => items[i]);
                    const run = translateBatch(lang, batch).then((out) => {
                        failedAt.delete(lang);
                        out.forEach((t, j) => {
                            if (t) { remember(keys[idxs[j]], batch[j], t); unparsedAt.delete(keys[idxs[j]]); }
                            else {
                                if (unparsedAt.size >= maxCacheEntries) unparsedAt.delete(unparsedAt.keys().next().value);
                                unparsedAt.set(keys[idxs[j]], now());
                            }
                        });
                        return out;
                    }).catch((e) => {
                        failedAt.set(lang, now());
                        log(`[suggestions-i18n] ${lang} translation failed: ${e.message}`);
                        return [];
                    });
                    for (const i of idxs) {
                        inflight.set(keys[i], run);
                        run.finally(() => inflight.delete(keys[i]));
                    }
                    waits.push(run);
                }
            }
            await Promise.all(waits);
            return items.map((s, i) => cache.get(keys[i]) || s);
        } catch (e) {
            log(`[suggestions-i18n] localize failed: ${e.message}`);
            return items;
        }
    }

    return {
        localize,
        /** The English prompt a translated prompt came from, or the input unchanged. */
        englishPromptFor: (prompt) => reverse.get(prompt) || prompt,
        _stats: () => ({ cached: cache.size, inflight: inflight.size }),
    };
}

export const suggestionTranslator = createSuggestionTranslator();
