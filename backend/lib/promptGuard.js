// Rejects a build prompt that is pasted code rather than a description. Patterns match whole words: the old substring
// check refused ordinary requests ("a CSV import system" contains "import sys", "import OSHA checklists" contains
// "import os", "retrieval(search)" contains "eval(") and told the person to stop pasting code.
const CODE_PATTERNS = [
    /\bimport +(?:os|sys|subprocess|asyncio)\b/,
    /\b(?:require|eval|exec|system)\(/,
    /\bsubprocess\./, /\bos\.(?:system|popen)/,
    /\bchild_process\b/, /\b(?:puppeteer|selenium)\b/,
    /\bwebsocket\.server/, /\bwebsockets\.connect/,
    /#!\//, /\bbash -c\b/,
    /\brm -rf\b/, /\b(?:chmod|chown) /,
    /\bdef __/, /\bif __name__/,
    /\bdocument\.cookie/, /\bwindow\.location\.href=/,
];

export function looksLikePastedCode(prompt) {
    const lower = String(prompt ?? '').toLowerCase();
    return CODE_PATTERNS.some((re) => re.test(lower));
}
