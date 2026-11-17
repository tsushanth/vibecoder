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

const hashOf = (s) => createHash('sha1').update(`${s.label}\u0000${s.prompt}`).digest('hex').slice(0, 16);
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function createSuggestionTranslator({
    getApiKey = () => process.env.ANTHROPIC_API_KEY,
    fetchImpl = (...a) => globalThis.fetch(...a),
    recordLlm = defaultRecordLlm,
    now = () => Date.now(),
    timeoutMs = 8000,
    failureCooldownMs = 60000,
    maxCacheEntries = 5000,
    log = (m) => console.error(m),
} = {}) {
    const cache = new Map();      // `${lang}|${hash}` -> { label, prompt }
    const inflight = new Map();   // `${lang}|${hash}` -> Promise<{label,prompt}|null>
    const reverse = new Map();    // translated prompt -> english prompt (lets "mark suggestion used" still match)
    const failedAt = new Map();   // lang -> timestamp of last failed batch

    async function callModel(lang, items) {
        const key = getApiKey();
        if (!key) throw new Error('no api key');
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        let recorded = false;
        try {
            const payload = items.map((s, i) => ({ i, label: s.label, prompt: s.prompt }));
            const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                signal: ctl.signal,
                headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 4096,
                    messages: [{
                        role: 'user',
                        content: `Translate these app-idea suggestions into ${languageName(lang)}. Keep each "label" short (2-3 words) and natural for a button chip, and keep each "prompt" a faithful, fluent translation that preserves every feature and design direction. Keep brand names and proper nouns (for example Kanban, Pomodoro, Netflix, Spotify, Trello, Slack, Notion, WhatsApp, Instagram, Medium, Typeform, VS Code, PNG, PDF, HTML, CSS, JS, WPM) as they are. Do not add or remove anything.\n\nInput JSON:\n${JSON.stringify(payload)}\n\nOutput ONLY a JSON array with one object per input, in the same order, each with the keys "i" (copied from the input), "label" and "prompt". No markdown, no explanation.`,
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
            const text = data.content?.[0]?.text || '';
            const m = text.match(/\[[\s\S]*\]/);
            if (!m) throw new Error('No JSON array in response');
            const arr = JSON.parse(m[0]);
            if (!Array.isArray(arr)) throw new Error('Not an array');
            const out = new Array(items.length).fill(null);
            for (const o of arr) {
                const idx = Number.isInteger(o?.i) ? o.i : -1;
                const label = clean(o?.label, 80);
                const prompt = clean(o?.prompt, 1200);
                if (idx >= 0 && idx < items.length && label && prompt) out[idx] = { label, prompt };
            }
            return out;
        } catch (e) {
            if (!recorded) recordLlm({ model: 'claude-haiku-4-5', feature: 'suggestions_translate', ok: false });
            throw e;
        } finally {
            clearTimeout(timer);
        }
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
                missing.push(i);
            });
            const cooling = failedAt.has(lang) && now() - failedAt.get(lang) < failureCooldownMs;
            if (missing.length && !cooling) {
                const batch = missing.map((i) => items[i]);
                const run = callModel(lang, batch).then((out) => {
                    failedAt.delete(lang);
                    out.forEach((t, j) => { if (t) remember(keys[missing[j]], batch[j], t); });
                    return out;
                }).catch((e) => {
                    failedAt.set(lang, now());
                    log(`[suggestions-i18n] ${lang} translation failed: ${e.message}`);
                    return [];
                });
                for (const i of missing) {
                    inflight.set(keys[i], run);
                    run.finally(() => inflight.delete(keys[i]));
                }
                waits.push(run);
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
