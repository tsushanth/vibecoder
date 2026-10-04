# VibeBuild: direct-generator failover when Claude is unavailable

Date: 2026-10-03
Status: draft for review
Scope: VibeBuild worker (`worker/server.js` on Hetzner 231.255). Audexa has its own spec.

## 1. Goal

VibeBuild keeps producing apps when Claude auth or quota fails. Today it returns HTTP 503 for an hour. Claude stays primary. Non-Claude models are a failover, never the default, so healthy traffic is unchanged.

Owner constraints:

- Availability regardless of Claude auth problems.
- Free providers first (Groq, Gemini, Cerebras). OpenRouter, using the owner's existing credits, is the one paid last resort.
- Claude is reached only through the OAuth CLI. No Claude call goes through OpenRouter or any API key.
- Full replacement of Claude is a possible later step (config only), not a goal now.

## 2. Current state (verified 2026-10-03)

The deployed worker is NOT the repo's `worker/server.js`.

| | Deployed (`/home/vibecoder/worker/server.js`) | Repo (`worker/server.js`) |
|---|---|---|
| Size | 980 lines, single-pass | 2,448 lines, multi-phase (generate, fix, polish) |
| Claude call sites | 3: `/generate` (20 turns), `/customize` (15), `/tweak` (12) | many, plus account-pool rotation |
| Validators, vibedata SDK | none | `validators.js`, `assets/vibedata.js`, `hasRealAppContent` |
| Quota handling | `quotaExhausted` flag set for 1 hour | rotation across accounts |

Consequences:

- On any quota-looking CLI output, `runClaudeCommand` sets `quotaExhausted = true` for 3,600,000 ms. While set, `/generate`, `/customize` and `/tweak` return 503 immediately. Users get an error for up to an hour even if the cause was one bad run. This is the availability gap.
- The CLI is `/usr/local/bin/claude-multi`, which fetches tokens from the shared broker on 192:3460. The same broker and credential-sync failures seen on Audexa (2026-10-03 emails: both slots unreadable) apply here.
- The "backup account" in the repo file (`/home/vibecoder2`) has a credentials file dated 2026-04-05 and is almost certainly dead. It is not in the deployed file anyway.
- `/health` currently reports healthy, `cliAvailable: true`, `quotaExhausted: false`.
- Recent logs (6,000 lines) show no quota errors. They show git-push failures on tweak flows and one 8-minute timeout. Those are separate issues.
- This spec's implementation must start from the deployed file. Deploying the repo file over it would ship large unreviewed behavior (see section 8, risk 1).

A build today: prompt, then the worker writes `CLAUDE.md` rules into a folder, then the CLI acts as an agent and creates `index.html` plus optional css/js (all inline, no external deps, mobile-first), then zip, preview deploy, optional APK.

## 3. Evidence from the feasibility spike

Run 2026-10-03 on the owner's laptop. Nothing in prod was touched. The spike script is throwaway, in the session scratchpad.

Method: the worker's real `CLAUDE_MD` rules plus the generate prompt, sent to free OpenRouter models. The model returns files as `<file path="...">` blocks, which are parsed and written to a folder. Checks: `index.html` over 200 chars, `checkExternalDeps` from `validators.js`, viewport meta, headless Chrome load, no JS errors after clicking every button, non-blank page. One validator-driven fix re-prompt on failure. 6 synthetic prompts (image generator, snake, expense tracker, calculator, pomodoro, guestbook). No real user prompts.

| Model (free, via OpenRouter) | Passed checks | First try | Median latency |
|---|---|---|---|
| nvidia/nemotron-3-super-120b | 6 of 6 | 5 | 24 s |
| nvidia/nemotron-3-ultra-550b | 5 of 6 | 3 | 146 s |
| cohere/north-mini-code | 4 of 6 | 4 | 156 s |
| poolside/laguna-s-2.1 | 3 of 6 | 3 | 72 s |
| google/gemma-4-31b | 0 of 6 (all 429) | 0 | n/a |
| qwen/qwen3.8-27b | 0 of 1 (429 after 4 retries) | 0 | n/a |

Findings:

- A direct (non-agent) generator can produce loading, clickable apps. The fix re-prompt rescued 3 runs.
- Free availability is unreliable: two models were rate-limited on every call, and one model passed in a smoke run then failed the same prompt in the full run. One free model is not enough. A chain is needed.
- Failure modes were format failures (`index.html` missing or truncated) and rate limits. These are catchable by validation and fallthrough.
- Quality is basic. Reviewed screenshots showed logic flaws the automated checks do not catch (a timer that starts on the wrong mode, a clipped progress ring, an output area empty on load). Pass rates are an upper bound.
- Not tested: `/customize`, `/tweak`, image-reference builds, a Claude baseline, and the direct providers (Groq, Gemini, Cerebras).

## 4. Design

### 4.1 Executor abstraction

`/generate`, `/customize` and `/tweak` each call a single `runBuild(kind, ctx)`:

1. Try `claude-cli` (existing `runClaudeCommand`, unchanged behavior).
2. If Claude fails with a quota or auth error, or the CLI is marked unavailable, run the `direct` executor and carry on to zip, deploy and APK as today.
3. The `quotaExhausted` flag stops returning 503. It now means "skip straight to direct for the next N minutes". The 1-hour window shrinks: one failed run re-probes after about 5 minutes.
4. If direct also fails after the whole chain, return the existing quota-style error and retry later, as today.

Healthy traffic is unaffected. Direct runs only when the user would previously have seen an error.

### 4.2 Direct executor

- Request: system = `CLAUDE_MD` plus an output-format instruction (file blocks only). User = the same generate prompt the CLI uses.
- Parse `<file path="...">` blocks. Tolerate markdown fences and prose around them. Reject paths containing `..` or absolute paths. Skip `vibedata.js`.
- Static checks (no browser needed on the worker): `index.html` exists and is over 200 chars, no external deps (deployed worker has no `checkExternalDeps`, so port `validators.js`), viewport meta present, inline and external JS syntax-checks with `node --check` or `new Function`.
- Optional second check: load via the existing screenshot service (`:3465`) to catch JS errors and blank pages. Treat as a follow-up if the service can report console errors.
- One fix pass: re-prompt with the problems and the model's previous output, same file-block format. If it still fails, the chain moves to the next model.
- Truncation (`finish_reason == length`): treated as failure, moves on.

`/customize` and `/tweak`:

- Send the existing project's text files (skip binaries and `.git`) in the user message and ask for only the changed or new files, as file blocks (`<delete path>` for removals).
- If the project exceeds the model's context budget, fail that link with a clear error. Never truncate silently.

Reference images: only models that accept images get the image. For others, drop the image and add a one-line note to the prompt. Not covered by the spike, so test before enabling.

### 4.3 Provider chain

Config, not code. Ordered chain, all behind one OpenAI-compatible client with a per-provider base URL and key:

```
direct chain: [groq, gemini, cerebras, openrouter-free (optional), openrouter-paid]
```

- Groq, Gemini and Cerebras are called directly. The owner will sign up for all three. Models are picked by a bake-off using the spike harness.
- OpenRouter appears only as the last two links, never in front of anything. No Claude model is used through it.
- Last-resort paid link:
  - Use a dedicated OpenRouter key for VibeBuild with a credit limit set in the OpenRouter dashboard (owner action). The key currently in the owner's shell is shared and has no limit (about $121 lifetime usage), so it must not be reused here.
  - Pick a cheap capable model by bake-off. Not Claude. Not a frontier-priced model.
  - Request `provider.data_collection: "deny"`.
  - Client-side daily cap on requests and on estimated cost. When the cap is hit, the link is skipped.
- Missing keys are skipped at startup and logged once. A per-link circuit breaker (about 5 minutes after repeated failures or 429s) avoids adding latency.

### 4.4 Observability and probes (the lesson from Audexa)

- Each link gets a synthetic probe at startup and every 15 minutes: a tiny file-block task through the real parser and checks. `/health` reports per-link status plus `fallbackAvailable`.
- Alert (existing Resend path) if every direct link is down for more than 30 minutes, or if a link has been down for more than 24 hours. Nobody should discover a dead backup by an outage. That is what happened to Audexa's API key.
- Structured log line per direct run: kind, provider, model, latency, tokens, fix-pass used, failure reason.
- Add `generator` (`claude` or `direct:<provider>/<model>`) and `phasesCompleted` to the result and callback payload. This is an additive field, so existing clients are unaffected. The backend may later surface it.

### 4.5 Rollout

1. Reconcile or isolate the drift first (section 6, step 0).
2. Ship behind `DIRECT_FALLBACK=off` (default). Verify no behavior change.
3. Enable the probes only, to confirm each link works end to end with real keys.
4. Turn the failover on. It affects only requests that Claude fails.
5. Force a Claude failure on a test project (set the quota flag, or run a test with the CLI path pointed at a failing stub) to confirm the failover end to end before relying on it.

## 5. Testing

- Unit: file-block parser (fences, prose, bad paths, truncation), static checks, chain ordering and fallthrough, breaker, daily cap, missing-key skip.
- Replay harness: adopt the spike's `run.mjs` for the bake-off. Models and prompts are inputs, results land in a browser gallery.
- Integration: stub Claude CLI that exits with a quota message, then assert `/generate` returns a valid bundle via a fake provider and the `generator` field is `direct:...`.
- Tweak and customize: replay recorded projects through direct, then diff against expectations (changed files only).
- Probe test: a dead link must raise an alert.

## 6. Phases

0. Prerequisite: decide the drift (section 8, risk 1). Implementation targets the deployed file unless the owner decides otherwise.
1. `/generate` with the direct executor, chain, probes. Failover only.
2. `/customize` and `/tweak` (existing-project context).
3. Bake-off with real providers once keys exist, then tune the chain.
4. Optional later: flip the chain order (goal c), or evaluate an open-source agent harness (opencode, Aider, and so on) if direct generation proves too weak for tweaks.

## 7. Out of scope

- Claude auth and broker reliability itself (shared with Audexa, tracked separately).
- Reconciling the repo and deployed `server.js` (a decision, see below).
- Self-hosted models (the Hetzner boxes have no GPU).
- Changes to the mobile app or `vibecoder-api`, apart from reading the optional `generator` field.

## 8. Risks

1. Drift: the repo file has validators, vibedata and multi-phase build that prod lacks. Reconciling is a separate, larger decision. Mixing it into this work would deploy unreviewed behavior. Memory notes already record one deploy that reverted live state from a dirty tree.
2. Quality: failover apps will be simpler and sometimes subtly buggy. Static checks and the fix pass catch format failures, not logic bugs. Mitigation: it only runs when Claude is down.
3. Free-tier availability and policy: rate limits, daily caps, model churn. Mitigation: a chain of three providers plus a capped paid last link, probes, breakers.
4. Data: user prompts and generated code go to the providers in the chain. Free tiers may retain or train on them. The OpenRouter paid link uses `data_collection: deny`. The free providers' policies need checking at sign-up.
5. Tweak and customize with direct generation are untested. They need a bake-off before enabling.
6. Cost: the paid link can spend. Mitigated by a dedicated limited key, a client-side daily cap, and an alert.

## 9. Open items for the owner

1. Create keys: Groq, Gemini, Cerebras, plus a dedicated OpenRouter key with a credit limit.
2. Confirm the data boundary: user app prompts and generated code may go to these providers. This is assumed accepted, since you asked for free providers plus OpenRouter, but it was not stated explicitly for VibeBuild.
3. Drift: deploy-from-deployed-file only, or reconcile the repo file first?
4. Should failover-built projects be marked in the app UI? Default: no, only logged.
