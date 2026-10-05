// Direct generation: a chain of models, one request each, automated checks, one fix pass, next model on failure.
import { parseFiles } from './files.js';
import { staticChecks } from './checks.js';

export const FORMAT = `

## OUTPUT FORMAT (overrides any instruction about using tools)
You cannot run tools. Reply with ONLY the project files, each COMPLETE, in this exact form:
<file path="index.html">
...full contents...
</file>
Emit every file in full (no ellipsis, no placeholders). index.html is required for a new app. For an edit, return only the files you changed or added, each complete. No text outside the <file> blocks. Do not recreate vibedata.js.`;

export const BUILD_RULES = `IMPORTANT RULES:
- index.html is the entry point; every function fully implemented, no stubs or TODOs
- All assets inline (SVG, CSS, canvas), no external resources
- Wire up EVERY button, link and interactive element with working handlers
- Complete game loops, full form validation and result display where relevant
- Use localStorage to persist user data where it makes sense
- Make sensible assumptions and never ask the user questions; if the request is unsafe or impossible as stated (for example real-money trading or live third-party data), build the closest safe, useful, self-contained version such as a simulator and say so inside the app`;

export function buildMessages({ rules, kind = 'generate', prompt, existing = null }) {
    const system = `${rules}${FORMAT}`;
    if (kind === 'generate') {
        return [
            { role: 'system', content: system },
            { role: 'user', content: `Create a complete web application for this user request: "${String(prompt).trim()}"\n\nRead the project rules above carefully.\n\n${BUILD_RULES}` },
        ];
    }
    const current = Object.entries(existing || {}).map(([p, c]) => `<file path="${p}">\n${c}\n</file>`).join('\n');
    return [
        { role: 'system', content: system },
        { role: 'user', content: `A user wants this change to the existing web application: "${String(prompt).trim()}"\n\nCURRENT FILES:\n${current}\n\nReturn only the files you change or add, each complete, keeping everything that already works.\n\n${BUILD_RULES}` },
    ];
}

const fixPrompt = (problems) => `Automated checks found these problems:\n- ${problems.join('\n- ')}\n\nReturn the COMPLETE corrected project in the same <file> block format. Emit all files in full.`;

async function evaluate({ text, kind, existing, check }) {
    const { files } = parseFiles(text);
    if (!Object.keys(files).length) {
        return { ok: false, cause: /<file\b/i.test(text || '') ? 'no_files' : 'declined_text', problems: ['no usable file blocks in the reply'], files };
    }
    const merged = kind === 'generate' ? files : { ...(existing || {}), ...files };
    const c = await check(merged);
    return c.ok ? { ok: true, files, merged } : { ok: false, cause: 'check_failed', problems: c.problems, files, merged };
}

/**
 * Returns { ok:true, files, model, attempts, costUsd, fixes } or { ok:false, cause, attempts, costUsd }.
 * `files` is the full project (existing files merged with the model's changes for edits).
 */
export async function generateApp({ prompt, kind = 'generate', existing = null, llm, models, rules, check = staticChecks, maxFixPasses = 1, deadlineMs = 480000, maxCalls = 4, now = () => Date.now() }) {
    const attempts = [];
    let costUsd = 0;
    let calls = 0;
    const deadline = now() + deadlineMs;
    for (const model of models) {
        if (deadline - now() < 15000) { attempts.push({ model, cause: 'timeout', error: 'build time budget used up' }); break; }
        if (calls >= maxCalls) { attempts.push({ model, cause: 'budget', error: 'call limit reached for this build' }); break; }
        if (llm.isOpen?.(model)) { attempts.push({ model, skipped: 'breaker open' }); continue; }
        const messages = buildMessages({ rules, kind, prompt, existing });
        let res;
        try {
            calls += 1;
            res = await llm.chat({ model, messages, deadline });
        } catch (e) {
            const cause = e?.name === 'BudgetExceededError' ? 'budget' : e?.deadline ? 'timeout' : 'provider_error';
            attempts.push({ model, cause, error: String(e.message).slice(0, 120) });
            if (cause === 'budget' || cause === 'timeout') break;
            continue;
        }
        costUsd += res.costUsd || 0;
        let outcome = await evaluate({ text: res.text, kind, existing, check });
        let fixes = 0;
        while (!outcome.ok && outcome.cause !== 'declined_text' && fixes < maxFixPasses && calls < maxCalls) {
            fixes += 1;
            calls += 1;
            messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: fixPrompt(outcome.problems) });
            try {
                res = await llm.chat({ model, messages, deadline });
            } catch (e) {
                outcome = { ok: false, cause: e?.deadline ? 'timeout' : 'provider_error', problems: [String(e.message).slice(0, 120)] };
                break;
            }
            costUsd += res.costUsd || 0;
            outcome = await evaluate({ text: res.text, kind, existing, check });
        }
        attempts.push({ model, ok: outcome.ok, cause: outcome.ok ? 'ok' : outcome.cause, problems: (outcome.problems || []).slice(0, 3), fixes });
        if (outcome.ok) return { ok: true, files: outcome.merged || outcome.files, model, attempts, costUsd, fixes };
    }
    const causes = attempts.map((a) => a.cause);
    const cause = causes.includes('check_failed') ? 'check_failed' : causes.includes('declined_text') ? 'declined_text'
        : causes.includes('no_files') ? 'no_files' : causes.includes('timeout') ? 'timeout' : causes.includes('budget') ? 'budget' : 'provider_error';
    return { ok: false, cause, attempts, costUsd };
}
