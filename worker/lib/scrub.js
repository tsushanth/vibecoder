// Redacts credentials that users paste into prompts so they are never forwarded to a model provider
// (and never copied into a generated app). Conservative on purpose: known key formats plus
// "key/secret/token/password: <long value>" patterns.
const KNOWN = [
    /AIza[0-9A-Za-z_\-]{30,}/g,                      // Google API key
    /\bAQ\.[A-Za-z0-9_\-]{30,}/g,                    // Google AI Studio key
    /\bsk-[A-Za-z0-9_\-]{20,}/g,                     // OpenAI, Anthropic (sk-ant-), OpenRouter (sk-or-)
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,   // GitHub tokens
    /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,               // Slack
    /\bAKIA[0-9A-Z]{16}\b/g,                         // AWS access key id
    /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, // JWT
    /\bsb_(?:secret|publishable)_[A-Za-z0-9_\-]{20,}/g, // Supabase
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g,   // Stripe
];
// "api key - XXXX", "token: XXXX", "password=XXXX" followed by a long opaque value: redact the value only
const CONTEXT = /\b(api[ _-]?key|secret(?:[ _-]?key)?|access[ _-]?token|auth[ _-]?token|token|password|passwd)(\s*(?:is|[:=\-])?\s*["']?)([A-Za-z0-9_\-./+=]{20,})(["']?)/gi;

export const PLACEHOLDER = '[REDACTED_SECRET]';

/** Returns { text, count } with credentials replaced by a placeholder. */
export function scrubSecrets(input) {
    let text = String(input ?? '');
    let count = 0;
    for (const re of KNOWN) text = text.replace(re, () => { count += 1; return PLACEHOLDER; });
    text = text.replace(CONTEXT, (m, label, mid, value, close) => {
        if (value === PLACEHOLDER || value.startsWith('[REDACTED')) return m;
        // keep ordinary long words and paths from being redacted: require a digit and a letter, or a separator typical of keys
        if (!(/[0-9]/.test(value) && /[A-Za-z]/.test(value))) return m;
        count += 1;
        return `${label}${mid}${PLACEHOLDER}${close}`;
    });
    return { text, count };
}
