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

Decision update 2026-10-03: if a non-Claude model performs acceptably in the bake-off, any such model reachable through the owner's OpenRouter credits is kept as the backup for when Claude OAuth fails, for now. Groq, Gemini and Cerebras stay optional later links. Reliable detection of Claude OAuth failure (4.7) is a hard requirement.

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

### 3.1 Correctness bake-off (2026-10-04)

The owner's criterion is correctness, not looks. 8 prompts (the first 6 plus a habit tracker and a drawing app); 10 models through OpenRouter, then the best three repeated twice more; the real Claude CLI (the production single-pass agent, no fix pass) as the baseline, run twice. Functional tests drive each app like a user: calculator results (7x8=56, (2+3)x4=20, precedence, keyboard), snake (moves, game over at a wall, restart, direction changes measured on the canvas), expense tracker (add, exact total 19.75, reload persistence, delete one), pomodoro (25:00, countdown, pause, reset, work-to-break switch and session counter on a 60x clock), guestbook (post, newest first, persistence), habit tracker (add, delete, persistence), drawing (mouse and touch strokes, undo, redo, clear, eraser, color, size, PNG download) and image generator (non-blank, differs per prompt). Each app runs in an isolated browser profile. The harness was checked against a deliberately broken calculator. Six flaws in the tests themselves were found by inspecting what the apps actually did and fixed (modal forms, confirm dialogs, a canvas below the fold, a wrong ink metric, a row locator confused by a new page element, and a label check that included tooltip text); all numbers below come from the corrected tests, applied identically to every run. A streak test and an empty-submit test are advisory only. A model that produced no usable index.html counts as incorrect for that prompt.

Fully correct apps out of 8 per run:

| Model | Run 1 | Run 2 | Run 3 | Total | Cost per app (run 1) |
|---|---|---|---|---|---|
| openai/gpt-5.6-luna | 6 | 7 | 6 | 19/24 (79%) | about $0.02 |
| claude (real CLI, baseline) | 5 | 7 | not run | 12/16 (75%) | n/a (OAuth) |
| moonshotai/kimi-k2.7-code | 6 | 5 | 6 | 17/24 (71%) | about $0.08 |
| deepseek/deepseek-v4-pro | 7 | 4 | 4 | 15/24 (63%) | about $0.09 |

Apps that produced nothing usable or failed the load and click check, over all runs: Claude 5 of 16, kimi 6 of 24, deepseek-pro 5 of 24, luna 1 of 24. Claude's misses include my 8-minute cap and one run where it asked a clarifying question instead of building, which a fixed harness setting could change.

Reading it:

- The models are indistinguishable on this evidence. Run to run, each model moves by 1 to 3 apps (DeepSeek went 7, 4, 4; Claude 5, 7), which is as large as the gaps between models. The first-round 7/8 for DeepSeek was not repeated. Do not rank them by these numbers.
- No model beats the Claude baseline reliably, and none is clearly worse. For a failover, that is the relevant finding: an acceptable app on most prompts.
- The habit tracker was the weakest prompt for every model (luna 0/3, kimi 1/3, deepseek 1/3, Claude 1/2). Luna's habit app throws a ReferenceError (`_ is not defined`). Kimi failed the calculator in all three runs, DeepSeek failed the image generator in all three.
- Editing an existing app (the `/tweak` flow): all four models implemented all three edits (an Ans button that recalls the previous result after AC, a "Highest expense" line that follows adds and deletes, a 140-character limit with a live counter) and none broke any existing feature, 12 of 12. Small sample: three edits, one base app, one run each. The fix pass was used for two of them.
- Not tested: image-reference builds, `/customize`, larger apps, repeat runs of the edit flow.
- Fix pass: many first attempts passed only after the validator-driven re-prompt, which supports building it in.

Chosen backup order for the OpenRouter-only phase: gpt-5.6-luna (cheapest, fastest, most consistent), then kimi-k2.7-code, then deepseek-v4-pro (slowest and the most expensive per app, least consistent). All three use the dedicated capped OpenRouter key from section 4.3, and no Claude model is used through OpenRouter. OpenRouter is a single point of dependency for the backup, accepted for now.

Spend on OpenRouter for these tests was about $7.13 (the shared key's lifetime counter rose more because other sessions use it).

### 3.2 Decision analysis: keep Claude CLI + backup, or move to direct generation (2026-10-04)

Production evidence from the deployed worker log (May 9 to Oct 3, 2026; the owner's own infra, aggregates only):

| Month | Builds started | Completed | Completion | Unique users |
|---|---|---|---|---|
| May | 53 | 47 | 89% | 16 |
| June | 255 | 192 | 75% | 52 |
| July | 190 | 111 | 58% | 81 |
| August | 74 | 52 | 70% | 29 |
| September | 39 | 14 | 36% | 15 |
| Oct 1 to 3 | 7 | 1 | 14% | 6 |

- Volume is down about 85% from the July peak: about 1.3 builds a day in the last 30 days. VibeBuild was already wound down in June (sms-bot, build-monitor and telegram-bot removed).
- The log cannot name the cause of a failed build, because failure paths call `sendError` without logging. What it does show: since August, 24 builds had a CLI that never produced a result, clustered on known credential and quota days (Aug 3, Aug 19, Sep 2, Sep 6, Sep 30 to Oct 2), and the rest of the non-completions are "Claude finished but no app was produced" (a quota or auth message, or the agent asking a clarifying question, which also happened once in 16 baseline builds). Attribution to Claude auth and quota is strong circumstantial evidence, not proof. Post-reseed (account A restored 2026-10-04) completion should be re-measured.
- APK builds logged: 115 (not Claude dependent; they need Java and the Android SDK on the VM).
- VM: Hetzner cpx31 at EUR 20.49 a month, load average 0.00, 1.3 of 7.7 GB memory used, 27% of 150 GB disk. Heavily oversized for this volume. A cx32 is EUR 9.99 (saves about EUR 10.50 a month); any resize needs the audit the Hetzner guardrail in the owner's notes requires.

Cost per month at today's volume (about 40 builds): direct generation with gpt-5.6-luna about $0.80; even at the June peak (256) about $5. Claude CLI has no marginal cash cost but shares two Max quotas with the Mac mini harnesses and Audexa. Cash is trivial either way; the difference is reliability and operational burden.

| | A. Claude CLI primary + direct backup | B. Direct generation only (Luna, then kimi, then deepseek) |
|---|---|---|
| Reliability evidence | The Claude path completed 36% of builds in September | In the bake-off, 23 of 24 luna builds loaded and passed the click check, and 79% were fully correct |
| Latency | 93 to 150 s; a hung CLI burns up to the 8 minute timeout before any fallback | 63 s median |
| Dependencies kept alive | CLI, broker, keychain, mini keepalive, OAuth lineage, detection, reseed, plus the direct path (two paths; the unprobed fallback problem seen on Audexa) | One path; OpenRouter is the single dependency (accepted; add a second provider later) |
| Quality on real prompts | Unmeasured for both; Claude may handle vague prompts better | Unmeasured on real prompts; bake-off prompts were clean and simple |
| Engineering | Everything in this spec | Direct generator plus probes; the Claude pieces are not needed for VibeBuild |

Audexa keeps the broker regardless, so retiring the CLI for VibeBuild does not retire that infrastructure; it only removes VibeBuild's exposure to it and its small quota draw.

Recommendation (pending the owner): B. Move VibeBuild to direct generation with luna first, kimi-k2.7-code second, deepseek-v4-pro third, with the validator-driven fix pass and per-link probes. The bar to beat is low: the current path completed 36% of September builds, and even a direct path at 70% is a large improvement. Keep the Claude CLI code available for a short trial period (30 days) only as a manual switch, not as a monitored fallback, and remove it afterwards, because an unmonitored fallback silently rots. Do the following before cutover:

1. Log the outcome and cause of every build (the silent failure paths), so completion rate is measurable. This is needed under either option.
2. Compare luna against recent real prompts before and during cutover. The owner must confirm that real user prompts may go to OpenRouter.
3. Roll out gradually (a share of traffic first), tracking completion rate against the Claude path.
4. Separately decide the VM: downsize to cx32 now, or later move APK builds to an on-demand job and delete the VM.

Open question for the owner: at about 1.3 builds a day and 15 users in September, is VibeBuild worth ongoing investment at all? Option B is the smallest change that fixes reliability. It is deliberately cheap to build.

### 3.3 Demand gap and how other builders handle it (2026-10-04)

Real prompts (27 distinct, Sept 1 to Oct 3), classified by an LLM (approximate): 15 of 27 (56%) require at least one capability beyond a static browser app, 12 (44%) have essentially no useful static version and 2 more can only be mock-ups. Needs, by number of prompts: live external data or third-party API 10; real-money or regulated actions 3; native device features 3; user accounts and login 2; background jobs and scheduling 2; file upload and storage 2; an AI model inside the app 2; shared backend database 1; multi-user realtime 1. Of the 13 prompts where Claude finished but produced no app in production, 8 needed something beyond static; 3 of the 6 that completed also did (they got mock-ups). Claude in agent mode sometimes answers with text offering a simpler alternative instead of building.

How competitors handle the same needs (from vendor docs and comparison articles, not hands-on testing):

- Replit Agent: Secrets store (encrypted, injected as environment variables; the Agent asks the user for an API key when it needs one), Connectors and Integrations that handle OAuth for third-party services, built-in Replit Auth, Google OAuth or Firebase Auth, provisioned databases (Replit Database or PostgreSQL, with the Agent inferring schema and migrations), Replit AI Integrations (model access without managing keys), one-click deployment to a public URL, an agent that tests its own app, and Plan Mode that asks clarifying questions and changes no code until the user approves. Multi-language, runs real server processes.
- Lovable: front end in React wired to Supabase as the managed backend: auth (email, social, magic link), Postgres with generated schema and row-level security, file storage, and Supabase Edge Functions (serverless) for payments (Stripe), emails, AI features, scheduled tasks and external API calls. Secrets live in the Supabase secret store and never reach the browser. Chat Mode for planning and debugging.
- Bolt: Node or Deno full-stack, bring your own auth (Clerk, Auth0) and database (Supabase).
- v0: Next.js front end with no backend of its own (Vercel ecosystem).
- Common pattern: the builder asks the user for credentials and keeps them server-side, the app calls a backend (container or serverless function), not the third party from the browser, and there are managed primitives for auth, database, storage, payments and jobs.

What this implies for VibeBuild (a small team, so the cheaper pattern matters): the Lovable model (generated front end plus a managed backend with auth, Postgres, storage, serverless functions with secrets, scheduled jobs, and an AI proxy) covers most of the 15 beyond-static prompts without running arbitrary user server processes, which is the expensive and risky part of the Replit model. VibeBuild already has a mini version of this (the vibedata shared key-value store behind vibecoder-api). Candidate backend: Supabase, or the owner's Basely project, or extending vibedata. A free keyless-API proxy with an allowlist, cache and rate limits would cover the many "show live data" prompts (prices, weather) without secrets. Real-money and regulated requests need an explicit policy (build a simulator or paper-trading version and say so) and not a silent decline. Replit-style Plan Mode maps to the spec-first normalizer in the permutation test, with a question only when something truly blocks the build (such as a missing API key).

Third-party API keys, the Lovable pattern (from Lovable's docs): when a feature needs a key, the agent asks for it through a secure input in the project chat (a key pasted into plain chat is recognized, and a reusable connector is offered); secrets are encrypted, stored only in the backend, write-only after saving (never shown again, only replaced or deleted), and injected into serverless functions at runtime so they never reach the browser; frontend variables (the `VITE_` prefix) are explicitly public and the secret store rejects that prefix; every server function must check who is calling because server-side alone is not private; a security view flags problems before publishing. Replit does the equivalent with its Secrets store (environment variables), Connectors that handle OAuth, and an Agent that asks for the key when needed. For VibeBuild this means tier 1 needs: a per-app secret vault, a serverless function runtime that injects secrets, generated apps that call those functions and never the third party directly (a key inside an APK or web bundle is extractable), a pre-publish scan that blocks hardcoded keys, and a secure chat input for keys.

Proposed capability tiers: tier 0 static prototype (cents, seconds; fits about 44% of real prompts fully); tier 1 static front end plus managed backend primitives (the target for parity); tier 2 full container runtime (Replit-style; later, expensive, needs sandboxing). Tier 1 needs an agent loop that can provision backend resources and verify with a real browser, which Option B's one-shot generator cannot do alone.

### 3.4 Pipeline permutations on the real prompts (2026-10-04)

Method: the 27 distinct real prompts since Sept 1, each run through nine pipelines. Each produced app was loaded in headless Chrome (load, console errors, every button clicked) and then judged by two different models (deepseek-v4-pro and kimi-k2.7-code) against 3 to 6 requirements extracted from the real prompt; the score is the mean requirement coverage from 0 to 1, with a missing app counted as 0. The two judges agree moderately (correlation 0.67, 83% of apps within 0.2), so differences under about 0.1 are noise. Spend on OpenRouter about $7.6; Claude CLI 54 builds in total on the owner's account. The owner spot-checks 10 apps by hand (page `out_perm/spot.html` in the scratch folder); that calibration is pending.

| Pipeline | Apps built (of 27) | Pass automated checks | Mean coverage (missing = 0) |
|---|---|---|---|
| A. Claude CLI alone (production today) | 21 | 18 | 0.55 |
| B. Luna alone (one shot plus one fix pass) | 27 | 27 | 0.68 |
| C. Spec-first, then Luna | 27 | 25 | 0.64 |
| D. Spec-first, then Claude | 27 | 20 | 0.60 |
| F. Claude, then Luna fixes or builds when Claude fails | 27 | 27 | 0.68 |
| G. Best of luna, kimi-k2.7-code, deepseek-v4-flash (an automated check picks) | 27 | 27 | 0.65 |
| H1. Router: simple prompts to Luna, complex to Claude | 23 | 20 | 0.57 |
| H2. Luna first, Claude only if checks fail | 27 | 27 | 0.68 (identical to B: Luna never failed the checks) |
| I. Luna, then Luna reviews and corrects its own app | 27 | 25 | 0.61 |
| E. Luna, then Claude fixes failures | not run | n/a | would equal B (Luna never failed the checks) |

Findings:

- Where Claude built an app (21 prompts), Luna alone is level with Claude alone: mean 0.69 vs 0.71, Luna better on 5, Claude better on 6, 10 ties (within 0.1). There is no quality edge for Claude on these prompts.
- Claude in agent mode built nothing on 6 of 27 (22%) real prompts: it replied with text, a question, or a safer alternative (for example real-money trading) and wrote no files. Luna built an app on all 6 (mean coverage 0.62). Counting those failures, Luna alone scores higher than Claude alone on the judge table (0.68 vs 0.55), but see the judge reliability finding below; the objective part holds regardless: Luna produced a loadable app on 27 of 27 prompts and passed the automated checks 27 of 27, against 21 and 18 for Claude. This is a large share of the production failures seen in the worker log.
- Spec-first (a normalizer that rewrites the prompt into a concrete spec) made Claude build every prompt (21 to 27) but lowered quality on the prompts it already handled (0.71 to 0.57), and did not help Luna (0.64 vs 0.68). Not worth making the default.
- Self-review (I) hurt (0.61 vs 0.68): Luna correcting its own app introduced errors, and 2 more apps failed the load checks. Best-of-three (G) and difficulty routing (H1) gave no gain; G costs about three times more. Verification should come from tools (load, console errors, click tests), not from another model pass.
- Prompts that need something beyond a static app (14 of 27) score lower for every pipeline (0.43 to 0.63), which is the tier-1 capability gap, not a model gap.
- Caveats: 27 prompts, one run each; scores are model judgments of source code plus runtime facts, not tests of each app; Claude ran in the same non-interactive mode the deployed worker uses.

Owner spot check (10 apps, models hidden, judged by whether the requested features work): of 7 paired prompts chosen for the largest score gaps and judge disagreements, the owner picked Luna 4 times, Claude once and called 2 both fine; on the 3 prompts where Claude built nothing, Luna's app was acceptable in 3 of 3. These were deliberately the most disputed cases, not a random sample.

Judge reliability finding: the two judge models agreed with the owner on only 1 of the 5 decisive picks (3 clear disagreements, 1 judge tie). In two cases the judges scored Claude's app far higher (0.90 vs 0.40, 0.95 vs 0.45) and the owner preferred Luna's. Reading source code plus load facts does not reliably predict whether features work in the browser. So the coverage-score table above must not be used to rank pipelines; it is kept as a record. The conclusions that stand are the objective ones (apps built, automated load and click checks, Claude building nothing on 22% of prompts) and the owner's hands-on calls. For tier-1 verification, replace model judging with executed tests: generate a browser script per requirement and run it, as the earlier hand-written functional tests did.

Recommendation (supersedes the Option A versus B discussion): use direct generation with Luna as the primary path (one shot, automated checks, one fix pass), keep kimi-k2.7-code and deepseek-v4-pro as fallbacks for provider outages, retire the Claude CLI for VibeBuild, and do not add spec-first, self-review, best-of-N or routing at tier 0. Revisit a stronger model only for the tier-1 agent loop.

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

### 4.6 Quality gate: apps that load but are bad

The spike showed apps that pass every check yet have logic flaws (wrong default mode, clipped ring, empty output area). Static checks cannot catch these. Layers:

- Behavioral smoke test (via the screenshot service or headless Chrome): click every control and require that the DOM or canvas changes for most of them. A page where clicks change nothing fails.
- Screenshot sanity: reject blank or near-uniform screenshots.
- Optional vision-judge on the screenshot against the user's prompt (free multimodal model). A signal only, never the sole gate.
- Failover builds are a stopgap, not a final product. The result carries `generator: direct:...`. When Claude recovers, the worker re-runs the build with Claude in the background and replaces or offers the upgrade (needs a small `vibecoder-api` change, to be scoped in the plan).
- Decision rule: if a task type's smoke-test failure rate or owner-rated garbage rate in the bake-off is above the owner's threshold, that task gets no failover and returns the existing queue-and-retry error instead.
- Quality breaker: a link whose smoke-test failures exceed a threshold over the last N builds opens, with an alert.

### 4.7 Claude OAuth health: know when it fails, and why (high priority)

Claude OAuth is in active production use for VibeBuild, so failures must be detected reliably and alerted with a cause and a fix hint. The failover keeps users unblocked and must never hide that Claude is down. Same design as the Audexa spec (section 3.9), applied to the worker on 231.255:

1. Canary every 5 minutes on 231.255 through the real path (`claude-multi -p "reply ok" --model haiku`, 30 s timeout, same wrapper and broker), independent of user builds.
2. A deterministic classifier shared by canary and real calls: `ok`, `quota`, `auth`, `broker_unreachable`, `timeout`, `empty_output`, `other`. No AI in the alert path.
3. Replace the one-hour `quotaExhausted` flag with `claude: {state, cause, since, lastOk, failoverCount}` on `/health`. The worker keeps re-probing every few minutes, so one bad run no longer disables Claude for an hour.
4. Alerts via the existing Resend path (plus a push channel the owner picks): immediately on a new cause, reminders every 6 h, a recovery notice. Each alert includes cause, since when, number of builds served by failover, and a fix hint (for example `auth: credentials unreadable -> re-sync creds / check broker`, `quota: spend limit -> raise at claude.ai/settings`, `broker_unreachable: check claude-broker on 192:3460 and network path from 231.255`).
5. Escalate severity when Claude is down and every failover link is also down.
6. The monitor does not depend on Claude or the broker for diagnosis.
7. The stale backup account (`/home/vibecoder2`, creds from 2026-04-05) is reported as a dead link instead of being silently kept in code.
8. Build on the existing credential mitigations described in the Audexa spec (3.9): the Mac mini keepalive and sync into broker slot B, the broker as single refresher, the laptop push cron disabled since 2026-08-03, and the 231 legacy chain (laptop tunnel on `0.0.0.0:3471`, `claude-token-refresh.sh` every 4 min, `claude-health.sh` Telegram and Twilio alerts every 15 min). VibeBuild's `claude-multi` fetches tokens from the 192 broker, so the 192 monitor, the mini heartbeat and the re-seed script cover VibeBuild too. The 231 canary should additionally check that the broker is reachable from 231, since the worker depends on that hop.

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
