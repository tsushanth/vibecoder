# Slice 1, step 2: built-in connectors and the AI proxy (decision record)

Date: 2026-10-04. Owner: Sushanth. Status: decided; provider terms verified for four candidates, one qualifies (see table).

## Decisions (owner)

1. Built-in keyless connectors: start with weather, crypto prices and a public-holiday or geocoding API. A provider is included only if its published terms allow commercial use without an account. VibeBuild is a commercial product, so "free for non-commercial use" is a disqualifier.
2. The AI proxy calls go through the platform OpenRouter key and count against each app's daily spend cap.
3. Default AI allowance: $0.05 per app per day, until pricing is set. This is a default, not a final price.
4. Everything is built locally and test-first on branch `tier1-slice1`. Nothing is deployed and no production system (Supabase project, OpenRouter key usage, Fly) is changed without a separate approval.

## Provider terms (read 2026-10-04 from the providers' own pages; quotes are the fetched summaries, not legal advice)

| Provider | Use | Finding | Decision |
|---|---|---|---|
| Open-Meteo free API | weather | "You may only use the free API services for non-commercial purposes." Commercial use needs a paid plan. | EXCLUDED on the free tier |
| US National Weather Service (api.weather.gov) | weather, US | "open data, free to use for any purpose", no fees. A unique User-Agent header is required and "will be replaced with an API key in the future". Rate limit not published. US-focused. | INCLUDE for US weather; send a unique User-Agent; expect an API key later |
| Nager.Date hosted API (nagerholidays.com) | public holidays | Terms of Service: "The Web API can be used for private or non-profit projects. For commercial purposes we require active sponsorship." Also bars using the data to operate your own holiday portal. The code is MIT on GitHub (self-hosting is possible, not done). | EXCLUDED unless we sponsor or self-host |
| Binance public market data (data-api.binance.vision) | crypto prices | Keyless market data only. The page states no commercial-use or redistribution terms and points to Binance's general terms, which have not been read. | NOT INCLUDED: the terms page could not be read through the fetch tool, so commercial use is unverified. Do not ship a crypto-price connector until someone reads Binance's API terms or a different source is checked. |

## Result

Only one candidate is verified for commercial use: US National Weather Service. Open-Meteo and the hosted Nager API are excluded. Binance is unverified. Crypto prices and public holidays have no approved built-in source yet.

## Consequences

- Global weather has no keyless commercial source in this list. Options: US-only via NWS, a paid Open-Meteo plan, or a creator-supplied key through the secrets connector. This is open.
- Every built-in connector must carry its terms review date and source URL in code, so a stale review is visible.
- Revisit all providers' terms before launch; they can change.

- Built-in connectors are platform-defined only. App-declared manifests may not set fixed headers (the proxy would otherwise let an untrusted app set arbitrary request headers); built-ins set a unique User-Agent as the NWS requires.
- App-declared connectors may not reuse a built-in name.
- AI proxy: platform picks the model allowlist (default `openai/gpt-5.6-luna`, the model used for direct generation); apps cannot choose arbitrary models; output and input sizes are capped; cost is read from the provider's reported usage, not guessed.

## Built (2026-10-04, branch tier1-slice1)

`platform/vibe-proxy/builtins.js` (NWS only, with terms metadata), `ai.js` (allowlisted model, 8,000 input characters, 800 output tokens, 20 messages, 30 s timeout, provider-reported cost recorded in micro-dollars, 200 micro-dollars charged when no cost is reported), 128 tests passing, every rule mutation-checked. Not built: crypto and holiday connectors (no approved source), per-app AI allowance configuration (the $0.05/day default is applied through the limiter's `dailySpendMicros = 50000`; the wiring that sets it per app is part of the edge wrapper), real token pricing display.

Known behavior: the spend cap is checked before a call, so one call can overshoot it by that call's cost (bounded by 800 output tokens on the default model).

## Step 3 built: browser SDK (2026-10-04)

`platform/sdk/vibe.js` exposes `vibe.api(connector, path, opts)`, `vibe.ai.chat(messages)` and `vibe.ai.ask(prompt)`. It follows `worker/assets/vibedata.js` conventions (ES5 IIFE, Promises, `err.status`, app id from `<id>.vibebuild.cc` or `window.VIBE_APP_ID`). It sends no caller headers or keys, never lets an app choose a model, and rejects with `status`, `code` and `retryAfter`. 143 tests across the proxy and SDK pass, all rules mutation-checked.

Open items:
- The default endpoint `https://vibe-proxy.vibebuild.cc` is a PLACEHOLDER. Nothing is provisioned there. The real host (Supabase function URL behind a custom domain, or the existing `vibecoder-api` Fly app) is an owner decision at the edge-wrapper step.
- The worker's external-dependency validator (`worker/validators.js`) must be taught to accept `vibe.js` the way it accepts a byte-identical `vibedata.js`, and `vibe.js` must be copied to `worker/assets/` and kept in sync. This is step 5 (generation changes).
- The SDK has been tested in a Node VM with a fake `window` and `fetch`, not in a real browser against a real server.

## Step 4 decisions (owner, 2026-10-04)

1. Hosting: a NEW small Fly app (`vibe-proxy`), not a Supabase Edge Function. Reasons weighed: a Supabase function's runtime environment includes the service-role key, which reaches all 38 tables of the live VibeBuild database (Replitor); a Fly app can use a Postgres role limited to the platform tables. The proxy code is web-standard and runs unchanged on either host. Costs and cold-start figures in the comparison were estimates, not measurements.
2. OpenRouter key for `vibe.ai`: the owner answered "same one", read as the $100 dedicated generation key. Risk accepted knowingly: one key means app AI usage and app generation share the $100 hard limit, which has no reset. OpenRouter cannot split a key's limit.
3. Mitigation built: a platform-wide daily cap on `vibe.ai` spend, applied on top of the per-app $0.05/day cap. Default 2,000,000 micro-dollars ($2/day). THE $2 FIGURE WAS MY PROPOSAL AND THE OWNER HAS NOT CONFIRMED IT. It is a configuration value, not a decision.
4. Nothing is deployed: no Fly app created, no Dockerfile or fly.toml yet, no secrets set, no database changes.

## Step 4a built: HTTP layer (`platform/proxy-app/server.js`)

Routes `GET /health`, `POST /:app/api`, `POST /:app/ai`. Per-app CORS (the app's own `<id>.vibebuild.cc` origin or a registered custom domain, https only), 200 KB body cap, client IP from `fly-client-ip` only (spoofed `x-forwarded-for` ignored), non-cacheable responses, request logs with no secrets, queries or prompts, platform AI cap, and the vault read limited to the one secret the connector declares. Storage is injected. 155 tests pass, rules mutation-checked.

Not built: the Postgres-backed app store, secret store (encrypted at rest) and limiter store; the entry point that wires them; Dockerfile and fly.toml. These need a database role and tables on a real Postgres, which is where production access starts and needs approval.

## Step 4b built: Postgres stores (local Postgres 17, 2026-10-04)

`platform/store/migrations/001_platform.sql` (schema `platform`: apps, app_secrets, limiter_counters, usage_events; row level security on every table, one policy granting only the `vibe_proxy` role) and `platform/store/pg.js`. Secrets use AES-256-GCM with the app id and secret name bound in as authenticated data, so a ciphertext copied to another app or name fails to decrypt; a wrong master key also fails. Limiter counters use one atomic upsert (40 concurrent increments produce exactly 1..40). 176 tests pass against a throwaway local database, including HTTP-to-Postgres end-to-end tests; the encryption, atomicity, expiry, validation and RLS rules were mutation-checked, which exposed three weak tests that were then tightened.

Caveats found while building:
- The migration creates a cluster-wide Postgres role `vibe_proxy`. On a managed Postgres this is an owner-level action and must be reviewed before applying anywhere real.
- Database tests share cluster-wide roles, so `npm test` runs them serially (`--test-concurrency=1`). A parallel run raced and left two scratch databases, which were verified empty and dropped.
- Nothing here has run against Supabase, Neon or any hosted Postgres, only a local Postgres 17.8. Row level security behavior on Supabase's own roles (anon, authenticated, service_role) is untested.
- There is no secret-rotation procedure yet (`key_version` is stored, always 1) and no write-only key-entry endpoint yet.

Still not built: the entry point that reads configuration and starts the server, the Dockerfile and `fly.toml`, a key-entry endpoint, and a Postgres host decision.

## Step 4c built: entry point, migration runner, container (2026-10-05)

`platform/proxy-app/config.js` (fail-fast env validation; errors name the setting, never its value; secrets are non-enumerable so logging the config cannot print them), `start.js` (wires config, Postgres stores, per-app and platform-wide AI caps, HTTP handler; refuses to start if the database is unreachable or the schema is not migrated), `index.js` (process entry, SIGTERM-graceful), `store/migrate.js` (ordered, checksummed, one transaction per file, advisory lock; refuses a migration whose contents changed after it was applied), `Dockerfile` (node:22-slim, non-root, no tests in the image) and `fly.toml` (validated with `flyctl config validate`; scale-to-zero, shared-cpu-1x 256 MB, /health check). 214 tests pass on local Postgres, mutation-checked. The built image was run against a throwaway Postgres container: migrate (twice), start, health, 404, 403, clean shutdown.

Still true, nothing deployed: no Fly app named `vibe-proxy` exists (the name is unchecked and unclaimed), no secrets set, no production database chosen. The $0.05 per app and $2 platform daily AI caps remain defaults the owner has not confirmed. The migration creates a cluster-level Postgres role `vibe_proxy` (NOLOGIN); the production `DATABASE_URL` user must be granted membership in it, and RLS behavior with a hosted provider's own roles is untested. `fly.toml` has no `release_command`: migrations are an explicit step. Scale-to-zero adds a cold start (about 1 to 3 seconds is an estimate, not measured).

## Step 6 built: secure key entry (2026-10-05)

Design: the proxy has no user logins, so keys are entered through a service-to-service admin API. The VibeBuild backend authenticates the creator and checks they own the app, then calls the proxy with a long shared token (`PROXY_ADMIN_TOKEN`, 32+ characters, required at startup). The proxy trusts that token and does no ownership check of its own.

Built and tested locally (263 tests on local Postgres, security rules mutation-checked):
- `proxy-app/admin.js`: `PUT /admin/apps/:app` (register with a validated manifest and custom domains), `PUT|DELETE /admin/apps/:app/secrets/:name`, `GET /admin/apps/:app/secrets` (names and update times only). Write-only: there is no route that returns a value. Constant-time token comparison; failures all return the same 401; 10 failed attempts per address per minute lock that address out (including with the right token); 8 KB body cap; no CORS headers ever; `no-store`; request logs record route, app id and status only. With no token configured every `/admin` path is a plain 404.
- `store/pg.js`: `secretStore.list` (names only).
- `vibe-proxy/capture.js`: finds pasted credentials (OpenAI, OpenRouter, Anthropic, Google, Gemini, GitHub, Stripe, AWS, Slack, Supabase, JWT, and "api key / secret / token / password" followed by a long value) and replaces each with `[SECRET:NAME]`; same value gives one entry, collisions get `_2`, `_3`; running it again finds nothing.
- `vibe-proxy/vault-capture.js`: `moveSecretsToVault` stores each found key through caller-supplied `listNames` and `setSecret` functions. Fail-safe: the returned text is always redacted, a failure to store reports the name as failed and never carries the value, and a failure to list existing names stores nothing under a guessed name.
- One end-to-end test: key pasted in chat, stored encrypted through the real admin HTTP API, used by a connector call, and absent from the vault ciphertext, list output, logs and usage rows.

Not built, and needed before this is useful to a creator:
- The backend side: calling `moveSecretsToVault` on chat messages and prompts, and the backend routes that call the admin API after an ownership check. This is a change to `vibecoder-api`, a production service.
- The mobile creator-app screen and chat UI for entering a key.
- Generation changes so the model knows `[SECRET:NAME]` placeholders and writes a manifest connector that uses the name; the worker's prompt currently teaches only the built-in `nws` connector and `vibe.ai`.

Known limits:
- Detection is a heuristic. Generic detection needs a digit in the value, so a long digit-free passphrase is NOT caught; a key that is split, spelled out or obfuscated is not caught; any provider format not in the list is caught only through the generic rule.
- The admin API shares a public hostname with the app routes. It is rate limited and token protected, but it would be safer reachable only over Fly's private network or from an allowlisted address; that is not configured.
- No audit log of admin actions, no secret versioning or rotation tooling (`key_version` is always 1), no deletion of an app's secrets when an app is deleted, no rotation procedure for `PROXY_ADMIN_TOKEN`.
- A secret is only as safe as the master key and the database: anyone with both can read all secrets.

## Owner decisions, 2026-10-05

1. **AI caps CONFIRMED:** $0.05 per app per day (`APP_AI_DAILY_MICROS=50000`) and $2 per day across all apps (`PLATFORM_AI_DAILY_MICROS=2000000`). These were previously unconfirmed defaults.
2. **Postgres host: reuse the existing Supabase project** (the VibeBuild production project, `Replitor`), not a new project and not Fly Postgres. This reverses the earlier recommendation to avoid Replitor; the owner chose reuse. Consequences to handle before applying anything:
   - Create the proxy's database login as its own role with access to the `platform` schema only. Never give the proxy the service-role key or the project's database owner credentials; its `DATABASE_URL` must use that restricted role. This is what keeps the other 38 VibeBuild tables out of reach of a proxy bug.
   - `store/migrations/001_platform.sql` creates a NOLOGIN role `vibe_proxy` and enables row level security on every platform table with a policy only for that role. A LOGIN role that is a member of `vibe_proxy` (with a password stored only in the Fly secret) must be created separately; that step is not scripted.
   - The `platform` schema must not be added to the project's API exposed schemas, and Supabase's anon and authenticated roles get no grants. After applying, run the Supabase security advisor and re-test that the anon key sees nothing in `platform`.
   - Row level security behavior with Supabase's own roles has only been tested on plain local Postgres, not on Supabase.
   - Connection limits and shared compute with the live app apply; the proxy uses a pool of up to 10 connections, which should be checked against the project's pooler settings.
   - The earlier 'shared project first, per-app projects later' plan is unchanged and now concretely points at this project.
3. **Push the platform branch and open a PR:** approved. Nothing is applied to Supabase and nothing is deployed by that.

## DEPLOYED 2026-10-05: vibe-proxy is live (not yet used by any app)

- **Database:** the existing Supabase project (Replitor). Schema `platform` (apps, app_secrets, limiter_counters, usage_events, schema_migrations), row level security on every table, one policy granting only the role `vibe_proxy`. A separate LOGIN role `vibe_proxy_app` (member of `vibe_proxy`, not superuser, no createrole or bypassrls, connection limit 8, statement timeout 15 s) is what the proxy connects as, through the Supabase session-mode pooler. Its password was set from a locally computed SCRAM verifier, so the plaintext never reached the database. Applied by the owner in the Supabase SQL editor (the migration call through the assistant's database tool was declined twice and was not worked around). Verified: the login role cannot read `users`, `projects`, `user_subscriptions` or `auth.users`; `anon`, `authenticated` and `service_role` have no usage on schema `platform`; the Supabase security advisor added only an INFO notice for `platform.schema_migrations`; the project's 20 existing public tables without RLS (other apps) are unchanged.
- **Hosting:** Fly app `vibe-proxy` (personal org, region sjc, one shared-cpu-1x 256 MB machine, scale to zero), https://vibe-proxy.fly.dev. Secrets: DATABASE_URL, VIBE_MASTER_KEY, PROXY_ADMIN_TOKEN, OPENROUTER_API_KEY (the dedicated generation key, as decided). Pool size 5 (`DB_POOL_MAX`) because the project allows 60 connections. AI caps as confirmed: $0.05 per app per day and $2 per day platform-wide.
- **Live tests passed** (with a throwaway app, afterwards disabled; its secret deleted; a few metering rows remain): health 200; admin API 401 without or with a wrong token; secret set and list (names only); a real National Weather Service call; a real `vibe.ai` call (cost recorded: 9 micro-dollars against both counters); a keyed echo connector showing the stored secret is decrypted from Supabase, injected upstream and redacted from the response; stored value is ciphertext only; blocked cases (path outside the allowlist 403, foreign origin 403, unknown connector 404, disabled app 403).
- **Not done / not measured:** nothing calls the proxy from a real generated app yet (the worker's `vibe.js` still has a placeholder base URL and the worker flag is off); no custom domain (the SDK expects `vibe-proxy.vibebuild.cc`, not set up); the rate limits and spend caps were exercised only by unit tests, not under load; cold-start time was not measured (the first request answered in 0.3 s because the machine was already started from the deploy); the admin API shares the public hostname; the backend key-entry routes (PR #7) are unmerged and `PROXY_ADMIN_URL` and `PROXY_ADMIN_TOKEN` are not set on the backend.
- **Operations:** the master key and admin token are in the owner's private folder (mode 600), never in a repo; losing the master key makes stored secrets unreadable, and no creator secrets exist yet.

## LIVE END TO END 2026-10-05: generated apps can use vibe.api and vibe.ai

- **Domain:** `https://vibe-proxy.vibebuild.cc` (DNS-only A and AAAA records for `vibe-proxy` in the `vibebuild.cc` zone, which override the wildcard for this one name; Fly certificate issued; TLS verifies). It is the SDK's built-in base URL, so published apps keep a stable address that is not tied to Fly's hostname. `vibe-proxy` is not an existing deployment name (checked); reserving it against future deployments is NOT yet enforced in the deploy route.
- **Registration:** the proxy admin API gained `ensure` (create if missing, never change an existing app) and `enabled` (flip only the flag). The backend registers an app with the proxy when it is deployed or when its preview is created (`preview-…` on generate, `prev-…` on the worker's build-complete callback), and disables it on undeploy. All best effort: a proxy problem is logged by error code and never fails a build or deploy. The backend has `PROXY_ADMIN_URL` and `PROXY_ADMIN_TOKEN` (release v30).
- **Worker:** `VIBE_PROXY_ENABLED=true` on the production worker since 2026-10-05 ~10:50 PT; builds now teach models the SDK, check its use and ship the real `vibe.js`. Roll back by setting it to `false` in the worker's `.env` and restarting (check `/health` activeGenerations is 0 first).
- **Verified live with real models and a real browser:** three real builds through the production worker (a US weather app, an AI joke app, and a plain tip calculator). The weather and joke apps shipped `vibe.js`, used only the existing connector and `vibe.ai.ask`, handled errors, and had no external URLs; the tip calculator got no SDK. Each was then loaded in headless Chrome as `https://zz-ensure-test.vibebuild.cc` against the live proxy: the weather app displayed a real National Weather Service forecast (two proxy calls, both 200), the joke app displayed a real AI joke (one call, 200), CORS preflights returned 204, a disallowed path returned 403. Three throwaway apps (`zz-livetest`, `zz-ensure-test`, `zz-backend-link`) were registered for this and have been disabled.
- **Also fixed:** the streaming generate path raised an unhandled rejection after every successful build and never sent the project-ready push (undefined variable); fixed and tested.
- **Not done / not measured:** three builds is a smoke test, not a quality measurement (how often models use the SDK correctly or invent connectors is unmeasured); custom domains that creators attach to their apps are not registered with the proxy, so the proxy would refuse those origins; the deploy route does not reserve the `vibe-proxy` subdomain; creator-keyed connectors have no generation support, and the key-entry routes stay inert until clients send a Supabase access token; no load test; cold start of the scale-to-zero proxy not measured; spend so far is a few cents.
