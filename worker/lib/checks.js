// Static checks for a generated project. The browser check (load, console errors, click every button) lives in the screenshot service.
import vm from 'node:vm';
import { checkExternalDeps } from '../validators.js';

const SKIP_SCRIPT_TYPES = /type\s*=\s*["']?(module|importmap|application\/json|application\/ld\+json|text\/template|text\/x-template)/i;

function syntaxProblem(name, code) {
    try {
        new vm.Script(code, { filename: name });
        return null;
    } catch (e) {
        return `syntax error in ${name}: ${String(e.message).slice(0, 100)}`;
    }
}

/** files: { 'index.html': '...', 'js/app.js': '...' }. Returns { ok, hasApp, problems }. */
export function staticChecks(files) {
    const idx = files['index.html'];
    if (!idx || idx.trim().length <= 200) return { ok: false, hasApp: false, problems: ['no usable index.html'] };
    const problems = [];
    for (const i of checkExternalDeps(files)) problems.push(String(i.issue).slice(0, 120));
    if (!/name=["']viewport["']/i.test(idx)) problems.push('missing viewport meta');
    for (const [p, c] of Object.entries(files)) {
        if (/\.js$/i.test(p) && p !== 'vibedata.js') {
            const e = syntaxProblem(p, c);
            if (e) problems.push(e);
        }
    }
    const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let m, n = 0;
    while ((m = re.exec(idx))) {
        if (/\bsrc\s*=/.test(m[1]) || SKIP_SCRIPT_TYPES.test(m[1]) || !m[2].trim()) continue;
        n += 1;
        const e = syntaxProblem(`index.html inline script ${n}`, m[2]);
        if (e) problems.push(e);
    }
    return { ok: problems.length === 0, hasApp: true, problems };
}
