// One JSON line per build, on every exit path, so completion rate and failure causes are measurable.
import fs from 'node:fs';

export const RESULTS = ['ok', 'no_files', 'check_failed', 'scan_failed', 'provider_error', 'timeout', 'declined_text', 'budget', 'cli_failed', 'cli_no_app'];

export function makeOutcomeLogger({ file = process.env.OUTCOME_LOG, write = (s) => console.log(s) } = {}) {
    return function logOutcome(rec) {
        const result = RESULTS.includes(rec.result) ? rec.result : 'provider_error';
        const line = JSON.stringify({ ts: new Date().toISOString(), event: 'build_outcome', ...rec, result });
        write(line);
        if (file) { try { fs.appendFileSync(file, line + '\n'); } catch { /* logging must never break a build */ } }
        return line;
    };
}
