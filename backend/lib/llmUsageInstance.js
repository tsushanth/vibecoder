// Claude-spend accounting for this backend (app "vibebuild"). Counts tokens and dollars per model and feature label,
// never prompts, answers or user ids, and reports them to the central app-failure-reporter Worker (POST /v1/llm).
// Inert until LLM_USAGE_KEY is set on the Fly app: the shared client would also fall back to FAILURE_REPORTER_KEY,
// which is a different key, so the fallback is deliberately switched off here.
import llmUsageMod from './llmUsage.cjs';

const { createLlmUsage } = llmUsageMod;

export function buildLlmUsage(env = process.env, extra = {}) {
    const key = env.LLM_USAGE_KEY || '';
    return createLlmUsage({
        app: 'vibebuild',
        key,
        enabled: !!key && env.NODE_ENV !== 'test',
        log: (m) => console.warn(`[llm-usage] ${m}`),
        ...extra,
    });
}

let current = buildLlmUsage();

/** Records one Claude response. Never throws. */
export function recordLlm(args) {
    try { current.record(args); } catch { /* accounting must never touch a request */ }
}

/** Flush with a hard cap so a slow Worker cannot hold shutdown open. */
export async function flushLlmUsage(capMs = 2500) {
    try {
        await Promise.race([current.flush(), new Promise((r) => setTimeout(r, capMs).unref())]);
    } catch { /* ignore */ }
}

/** Test seam: swap the instance (e.g. one with a fake fetch and key). */
export function setLlmUsageForTests(inst) { current = inst; }
