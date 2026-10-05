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
