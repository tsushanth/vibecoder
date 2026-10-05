# VibeBuild direct generation: implementation plan

Date: 2026-10-04
Status: draft for review. Nothing here is built or deployed.
Specs: `docs/superpowers/specs/2026-10-03-vibebuild-direct-generator-failover-design.md` (sections 3.1 to 3.4 hold the evidence and the decision), `2026-10-04-vibebuild-tier1-building-blocks-scope.md` (what comes after).

**Goal:** make generation reliable by moving `/generate`, `/customize` and `/tweak` off the Claude CLI onto direct generation with Luna as primary (kimi-k2.7-code and deepseek-v4-pro as fallbacks), with automated checks, one fix pass, outcome logging and health probes. Target (owner decision 2026-10-04): at least 80% of real prompts produce an app that loads and passes the click checks. Evidence: on 27 real prompts Luna built 27, Claude CLI built 21, and the owner preferred Luna 4 to 1 (2 both fine) on the most disputed cases.

**Architecture:** the worker keeps its routes, zip, preview deploy and APK steps. A new `generate` module replaces the CLI step. Chain: for each model in order, one request returns file blocks, static checks run, one fix request if needed, next model on failure. The Claude path stays behind a flag for a short trial, then is removed.

**Base:** the deployed `/home/vibecoder/worker/server.js` on 231.255 (980 lines), not the repo's 2,448-line `worker/server.js`, which has drifted (it has validators, the vibedata SDK and multi-phase builds that production lacks). Assumption to confirm with the owner: build from the deployed file.

**Baseline facts the plan must respect**
- The worker runs under pm2 as `vibecoder` on Hetzner, not on Fly. Its secrets live in `/home/vibecoder/worker/.env`. Never overwrite an existing value; add `OPENROUTER_API_KEY` only with a value the owner provides.
- The OpenRouter key must be a dedicated one with a credit limit set in the OpenRouter dashboard (owner action); the shared key has no limit.
- Reasoning models spend hidden tokens: give calls 24,000 or more output tokens and retry an empty reply that ended with `finish_reason: length` with a doubled budget (this broke the first bake-off and the first judge calls).
- Real user prompts go to OpenRouter and the model providers behind it. Owner to confirm this boundary explicitly.

## Status (2026-10-04, evening)

Owner decisions: success threshold 80%; real prompts may go to OpenRouter and the model providers behind it; the private replay set lives in Supabase; build from the deployed worker file.

Built and committed locally on branch `direct-generation` in the worktree `~/Documents/GitHub/worktrees/vibebuild-direct-generation` (not pushed, not deployed):

- Task 0 done: commits `4867ad0` (server.js and brokerReady.js byte-identical to production, sha256 58c0cfb1d98dc99d... verified) and `ccc30c1` (package.json rebuilt from the printed content, 150 bytes, hash not yet compared with production because SSH to the worker box became unreachable).
- Tasks 1 to 5 done: `worker/lib/{outcome,llm,files,checks,generate}.js` with 18 unit tests, all passing (`node --test worker/test/direct/`). Static checks only; the browser check through the screenshot service is not built yet.
- Task 6 done: `/generate`, `/customize` and `/tweak` route through direct generation per request with probability `DIRECT_PERCENT` (default 0). At 0 the Claude path is unchanged. Direct failures return a real error; the existing Claude path still returns `success: true` with an unchanged bundle when a customize or tweak run fails for a non-quota reason (a pre-existing silent failure, left alone on purpose). Results carry `generator` and `model`; `/health` reports the direct configuration; one outcome line per build in `outcomes.jsonl`.
- Added (not in the original plan): `worker/lib/scrub.js` redacts pasted credentials from prompts before any provider sees them, and the worker's log lines now carry at most 200 scrubbed characters of a prompt instead of the whole prompt.
- Tested end to end with a fake provider (14 of 14 checks: flag off uses the Claude path and never calls the provider, flag on returns bundles, the fix pass rescues a bad draft, prose-only replies and failed edits return errors, one outcome line per build, a pasted key is redacted before the provider). No real provider and no Claude quota was used.
- Replay set: table `public.replay_prompts` in the Replitor Supabase project, 27 real prompts, RLS on with no policies (service role only), verified by hash against the redacted local copy, public key reads 0 rows. The one prompt that contained a live API key is stored redacted.

Not done:

- Task 7 (probes) and Task 4's browser check, Task 8 (replay harness in the repo, reading the Supabase table with the service role key).
- Deployment. Needs, from the owner: a dedicated OpenRouter key with a credit limit (no key has been created or set anywhere); SSH to the worker box (port 22 timed out from this machine, the worker and API themselves answer normally). Deployment steps when ready: copy `worker/server.js` and `worker/lib/` to `/home/vibecoder/worker/`, add `OPENROUTER_API_KEY` (owner-provided value, never overwrite an existing secret) and leave `DIRECT_PERCENT` at 0, restart the pm2 process, confirm `/health`, then 10%, 50%, 100% against the 80% completion target. Confirm the box's Node version supports global `fetch` (Node 18 or later).

## Deployment (2026-10-04, night): LIVE AT 0%

Branch `direct-generation` at `e1d291f` was deployed to `/home/vibecoder/worker` on the vibebuild-worker box (231.255) in one SSH session: 9 files (server.js, lib/*, validators.js, assets/vibedata.js) verified by sha256 against the local build; backups `server.js.bak.before-direct.1791157045` and `.env.bak.before-direct.1791157045` in the same directory; `.env` gained `OPENROUTER_API_KEY` (the owner's dedicated key, $100 limit, no reset, expires 2027-10-04), `DIRECT_PERCENT=0`, `DIRECT_DAILY_BUDGET_USD=3`, `DIRECT_DEADLINE_MS=480000`; pm2 `vibecoder-worker` restarted; `/health` 200 and reports `direct: {enabled: true, percent: 0, models: [luna, kimi-k2.7-code, deepseek-v4-pro]}`. At 0% every build still uses the Claude CLI exactly as before. Outcome lines now go to `/home/vibecoder/worker/outcomes.jsonl` and stdout.

Real-provider test before deploy (local worker, real OpenRouter, dedicated key): 4 real prompts (counter, weather, trading bot, chat app) all built by Luna in 16 to 88 s, total $0.04 (about $0.01 per build; the trading-bot prompt needed one fix pass). A diagnostic found that a prompt asking for live external data can cascade through fix passes and three models for over five minutes, so builds are now bounded (8 minute deadline, 150 s calls with 3 attempts, at most 4 provider calls).

Rollback: `cp server.js.bak.before-direct.1791157045 server.js && cp .env.bak.before-direct.1791157045 .env && su vibecoder -c 'pm2 restart vibecoder-worker'`. To turn direct generation up or down, change `DIRECT_PERCENT` in `.env` and restart (check `/health` first: only restart when `activeGenerations` is 0).

Rollout note: at about 1.3 builds a day a 10% canary produces roughly one direct build every eight days, too few to measure completion. Gate on the replay set and synthetic probes instead, then move quickly with a daily review of `outcomes.jsonl` and the Claude path one environment change away.

## Dependency found 2026-10-04: RiddleVerse game creation uses the 192 worker (OWNER DECISION OPEN)

Reported by the session auditing Hetzner 192 and partly verified by me (read-only, 2026-10-04):

- RiddleVerse's backend (`RiddleVerse/web/backend/routes/gameCreation.routes.js`) sends game creation to `GAME_WORKER_URL`. Verified calls in that file: `/generate`, `/generate-harder`, `/generate-next-level`, `/init-repo`, `/tweak`, `/customize`, `/versions/:repo`. The value of `GAME_WORKER_URL` is a Fly secret that I have not read; the other session says it points at the 192 worker (`/home/vibecoder/worker/server.js`, pm2 `vibecoder-worker`, port 3456), which generates through `claude-multi` and so depends on the Claude broker.
- The 231 worker (the direct-generation one) has `/generate`, `/customize`, `/init-repo`, `/tweak`, `/versions/:repo`, `/bundle/:repo`, `/build-apk`, `/revert`, `/ready` and `/health`. It does NOT have `/generate-harder` or `/generate-next-level`. The other session also says the 192 worker has async `/jobs/*`; I did not find `/jobs` calls in the RiddleVerse file and have not verified that.
- Consequence: when 192 and the Claude broker retire, RiddleVerse game creation (create, harder, next level) breaks unless `GAME_WORKER_URL` moves to a worker that has those endpoints and no Claude CLI dependency. Reported usage is low and none since 2026-08-19.
- These are different products: RiddleVerse game generation has its own prompts and a three-stage flow, so adding two endpoints to the 231 worker is a design task, not a copy. It is not planned or built.

Owner decision (RELAYED by the 192-audit session on 2026-10-05; not yet confirmed to this session by the owner): option 2, port `/generate-harder` and `/generate-next-level` to the direct-generation worker (Luna > Kimi > DeepSeek, no Claude CLI), then repoint `GAME_WORKER_URL`. The broker and the 192 worker stay until the port is live and the repoint is done.

Work still unknown before the port can be designed (from the same session, none verified by me):
- 192's RiddleVerse worker has its own prompts and a three-stage flow (generate, fix, polish, each through the Claude CLI with turn limits 15, 10 and 8). The 231 and 192 worker copies diverged, so it is unknown whether 231's `/generate` and `/customize` behave the same for RiddleVerse.
- What `GAME_WORKER_URL` points at (Fly secret on `quiz-web-frontend`, unread; its machines are stopped, so waking one only to read it has a small side effect).
- Whether game quality holds on the cheaper models. RiddleVerse games are HTML in a mobile WebView, so a bake-off on real RiddleVerse prompts, like the VibeBuild one, would settle it. Not run.
- Who builds it is not decided.

Options considered (the owner chose 2):
1. Drop RiddleVerse game creation and retire the 192 worker with the broker.
2. Port the missing endpoints to a direct-generation worker, using the same chain and checks as VibeBuild, then repoint `GAME_WORKER_URL`.
3. Keep the 192 worker and the broker for RiddleVerse only. This keeps the box and the Claude dependency alive.

Until the owner decides: do not retire the broker or the 192 worker, and do not change `GAME_WORKER_URL`. I have not touched RiddleVerse, 192 or any Fly secret.

## Security findings from this work

- A real user pasted a live Gemini API key into a prompt. The Claude agent copied it into the generated app's `index.html` (three scratch outputs), which in production would have published a live key inside a public app. The key also sits in plaintext in the worker's pm2 log on the box and was sent to model providers during the replay and permutation tests before the scrubber existed. Recommended: the owner decides whether to contact that user to rotate it; redact that line in the box's log; scan published bundles for key patterns. The 1,460 stored `projects.initial_prompt` values match none of the common key patterns (count-only check).
- This reinforces the tier-1 requirement for a secure key entry and a pre-publish key scanner.

## Tasks

### Task 0: baseline snapshot
- [ ] `scp` the deployed `server.js` to a branch `direct-generation` (new commit named "snapshot of deployed worker 2026-10-04", content byte-identical to production). Record its sha256 in the commit message.
- [ ] Keep the repo's current `worker/server.js` in history; do not deploy it.
- Done when: the branch diff against production is empty.

### Task 1: outcome logging (do first, also valuable alone)
- [ ] Add `worker/lib/outcome.js`: one JSON line per build with request id, kind (`generate`, `customize`, `tweak`), generator, model, attempts, latency, cost, result (`ok`, `no_files`, `check_failed`, `provider_error`, `timeout`, `declined_text`) and a short cause.
- [ ] Call it on every exit path of the three routes, including the silent `sendError` paths.
- [ ] Test: unit test each result class with fakes; run a build in staging and confirm exactly one line.
- Done when: completion rate per day can be computed from the log alone.

### Task 2: provider client
- [ ] `worker/lib/llm.js`: OpenRouter chat call with timeout, retry on 429 and 5xx with backoff, empty-reply retry with doubled `max_tokens`, cost from `usage.cost`, daily request and spend caps, circuit breaker per model (open after 3 consecutive failures for 5 minutes).
- [ ] Tests with a fake HTTP server: 429 then success, empty reply with `length`, breaker opens and closes, cap reached.

### Task 3: file blocks
- [ ] `worker/lib/files.js`: parse `<file path="...">` blocks (fences and prose tolerated), reject `..` and absolute paths, skip `vibedata.js`, write atomically; read an existing project for edits with size caps (fail clearly when too large, never truncate).
- [ ] Tests: fenced output, prose around blocks, bad paths, truncated output, unicode.

### Task 4: checks
- [ ] `worker/lib/checks.js`: index.html present and over 200 chars, no external dependencies (port `validators.js`), viewport meta, `node --check` on JS files.
- [ ] Browser check through the existing screenshot service on port 3465: add a `/check` endpoint that loads the app headless, collects console errors and clicks every button (the logic proven in the spike harness); the worker calls it before packaging.
- [ ] Tests: apps that are blank, throw on load, throw on click, load external scripts.

### Task 5: orchestrator
- [ ] `worker/lib/generate.js`: system prompt = the existing `CLAUDE_MD` rules plus the file-block format; user prompt = the existing generate prompt plus the rule to make assumptions and never ask questions (build a simulator for real-money requests and say so); chain luna, kimi-k2.7-code, deepseek-v4-pro; one fix pass per link driven by check failures; return files plus metadata.
- [ ] Tests with fake providers: first model fails checks and the fix pass rescues; first model errors and the second succeeds; all fail and the route returns the existing error shape.

### Task 6: routes behind a flag
- [ ] `GENERATOR=claude|direct` (default `claude`) and `DIRECT_PERCENT` (0 to 100) read per request; `/generate` first, then `/customize` and `/tweak` (existing files as context).
- [ ] Result payload gains `generator` and `model` (additive).
- [ ] Test: with `DIRECT_PERCENT=0` behavior is byte-identical to today; with 100 the CLI is never spawned.

### Task 7: probes and health
- [ ] Per model, a synthetic probe at start and every 15 minutes (tiny prompt through the real parser); `/health` reports link state and `claude` state; alert through the existing failure reporter when every link is down for 30 minutes.

### Task 8: replay harness in the repo
- [ ] Move the spike harness into `worker/test/replay/`: run a prompt file through the orchestrator, check apps in the headless browser, write a results table. Keep a fixed set of the 27 real prompts (stored privately, not in the public repo) plus the 8 synthetic prompts.

### Task 9: rollout
- [ ] Deploy with `DIRECT_PERCENT=0`; verify no change.
- [ ] 10%: compare completion rate and outcome causes against the Claude path for a few days; 50%; 100% when direct completion is at least the Claude rate and at least 80% on real prompts.
- [ ] Rollback is one environment value (`DIRECT_PERCENT=0`) and a pm2 restart.

### Task 10: after 30 days at 100%
- [ ] Remove the Claude CLI path, `claude-multi` use, the broker dependency, the 8 minute timeout logic and the stale `/home/vibecoder2` account reference.
- [ ] Stop the Mac mini keepalive and slot sync jobs and retire the legacy `sync_claude_creds.sh` (it contains a plaintext keychain password; rotate it).
- [ ] Audit before any VM resize (the cpx31 is idle, about EUR 20.49 a month; a cx32 is EUR 9.99); APK builds still need Java and the Android SDK.

## Risks
- Real prompts are messier than test prompts and one-shot generation may fail on large ones; the outcome log and gradual rollout exist to catch this.
- OpenRouter is a single dependency; add a second direct provider later.
- Weak model output on complex edits (`/tweak` was only tested on three small edits); keep the Claude flag during the trial.
- A shared test project is production: do any Supabase testing with isolated names and cleanup, as in the spike.

## Open decisions for the owner
1. Build from the deployed `server.js` (assumed).
2. Create the dedicated OpenRouter key with a credit limit.
3. Confirm real user prompts may be sent to OpenRouter and its model providers.
4. Rollout speed (threshold decided: 80%).
5. (decided) the replay set lives in Supabase.
