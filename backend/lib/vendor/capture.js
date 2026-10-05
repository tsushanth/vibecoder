// Finds credentials a creator pasted into chat and replaces each with a [SECRET:NAME] placeholder, so the caller can store the
// value in the vault (write-only) and the conversation, the model prompt and the app never contain it.
const SPECIFIC = [
    { kind: 'openrouter', name: 'OPENROUTER_API_KEY', re: /\bsk-or-v1-[A-Za-z0-9]{20,}/g },
    { kind: 'anthropic', name: 'ANTHROPIC_API_KEY', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
    { kind: 'openai', name: 'OPENAI_API_KEY', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
    { kind: 'google', name: 'GOOGLE_API_KEY', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
    { kind: 'gemini', name: 'GEMINI_API_KEY', re: /\bAQ\.[A-Za-z0-9_-]{30,}/g },
    { kind: 'github', name: 'GITHUB_TOKEN', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
    { kind: 'stripe', name: 'STRIPE_SECRET_KEY', re: /\b[sr]k_live_[A-Za-z0-9]{16,}/g },
    { kind: 'aws', name: 'AWS_ACCESS_KEY_ID', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { kind: 'slack', name: 'SLACK_TOKEN', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
    { kind: 'supabase', name: 'SUPABASE_SECRET_KEY', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
    { kind: 'jwt', name: 'JWT_TOKEN', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];
// "api key: <long value>", "secret = <long value>", "token <long value>", "password is <long value>"; the value must contain a digit
const GENERIC = /(\b(api[ _-]?key|secret|token|password)\b(?:\s+is\b|\s*[:=])?\s*["'`]?)([A-Za-z0-9_\-+/=.]{20,})/gi;
const GENERIC_NAMES = { apikey: 'API_KEY', secret: 'SECRET', token: 'TOKEN', password: 'PASSWORD' };

/** Returns { text, found: [{ name, value, kind }] }. `existingNames` are vault names that must not be reused. */
export function extractSecrets(input, { existingNames = [] } = {}) {
    if (typeof input !== 'string') return { text: '', found: [] };
    const found = [];
    const byValue = new Map();
    const used = new Set(existingNames);
    const place = (value, base, kind) => {
        if (byValue.has(value)) return `[SECRET:${byValue.get(value)}]`;
        let name = base;
        for (let n = 2; used.has(name); n += 1) name = `${base}_${n}`;
        used.add(name);
        byValue.set(value, name);
        found.push({ name, value, kind });
        return `[SECRET:${name}]`;
    };
    let text = input;
    for (const p of SPECIFIC) text = text.replace(p.re, (m) => place(m, p.name, p.kind));
    text = text.replace(GENERIC, (all, prefix, word, value) => {
        if (!/\d/.test(value)) return all;
        return prefix + place(value, GENERIC_NAMES[word.toLowerCase().replace(/[ _-]/g, '')], 'generic');
    });
    return { text, found };
}
