# VibeBuild tier 1: managed backend building blocks (scope)

Date: 2026-10-04
Status: scoping draft for review. Nothing here is built or deployed.
Related: `2026-10-03-vibebuild-direct-generator-failover-design.md` (reliability, bake-off, demand analysis in 3.1 to 3.3).

## 1. Goal

Move VibeBuild from static prototype apps (tier 0) to apps that behave like real products (tier 1) without running arbitrary user server processes (tier 2). A generated app keeps a static front end and gains managed backend building blocks: secrets and serverless functions, live data, auth, a database, storage, an AI proxy, scheduled jobs, and native device features in the Android package.

Non-goals for tier 1: a full container runtime (Replit-style), realtime multiplayer, arbitrary languages, an in-browser IDE, team collaboration.

## 2. What exists today (verified in the repo and logs)

| Piece | State |
|---|---|
| Static hosting | `deploy-server` on Fly serves bundles from Supabase Storage on `*.vibebuild.cc`, with custom domains |
| Per-app data | `vibedata` key-value store behind `vibecoder-api` (Supabase tables): 32 KB per value, 1,000 keys, 5 MB per app, Origin check, per-IP rate limits, no end-user auth (anyone who can open the app can read and write) |
| Creator side | `vibecoder-api` on Fly: auth, coins (credits), subscriptions, custom domains, GitHub export, push |
| Packaging | worker on Hetzner builds an Android APK from the web bundle (115 APK builds logged); iOS has a creator app only |
| Generation | static apps only, no network calls except `vibedata` (enforced by `validators.js` in the repo version) |
| Not present | secrets, serverless functions, end-user auth, SQL database, file storage, AI proxy, cron, notifications for end users |

## 3. Demand these blocks answer (27 real prompts since Sept 1, LLM-classified, approximate)

Live external data or API 10; real-money or regulated actions 3; native device features 3; user accounts 2; background jobs 2; file upload 2; AI model inside the app 2; shared database 1; multi-user realtime 1. 15 of 27 (56%) need something beyond static. Prompts can need several.

## 4. Building blocks

Size is a rough relative estimate for one engineer working with AI assistance: S = days, M = 1 to 2 weeks, L = 3 or more weeks. These are my estimates, not measurements.

| # | Block | What the app gets | Server design | Demand covered | Size |
|---|---|---|---|---|---|
| 1 | Data proxy | `vibe.data.get('weather', {...})`: live public data with no key | Allowlisted keyless APIs (prices, weather, news, sports, maps), response caching, rate limits, SSRF guard (no private ranges, no redirects to them, DNS rebinding safe) | live data (most of the 10) | S to M |
| 2 | Secrets vault + functions | Server-side code that calls any third-party API with the creator's key; the browser never sees the key | Per-app write-only encrypted vault; per-app functions in an isolated runtime with secrets injected at run time; egress through an allowlisting outbound layer; CPU, memory, subrequest and body caps; logs | keyed APIs, payments via the creator's own keys, email, webhooks | L |
| 3 | AI proxy | `vibe.ai.generate()` / chat with no key | Metered per app and per end user, OpenRouter behind it, budgets tied to the creator's coins or plan | AI-in-app (2), chat-style apps | M |
| 4 | End-user auth | sign in with email magic link and Google | Per-app JWT sessions scoped to appId; `ctx.user` available in functions; start without passwords | accounts (2), anything multi-user | L |
| 5 | SQL database | real tables, queries, ownership rules | Per-app schema and scoped role (schema-per-tenant, as Basely already does); access only through functions or an authenticated SDK; agent-generated migrations | database (1), most SaaS-like apps | M to L |
| 6 | File storage | user uploads, images | Per-app bucket, signed URLs, size and type quotas, virus and abuse limits | storage (2) | M |
| 7 | Scheduled jobs | recurring tasks | Cron triggers on top of block 2 with a minimum interval and run caps | jobs (2) | S once block 2 exists |
| 8 | Notifications | email to users; SMS later | Email through the function runtime with a platform sender and per-app caps; push for end users later | part of jobs and accounts | M |
| 9 | Native device bridge | camera, geolocation, share, haptics, push in the APK | Replace the plain WebView wrapper with Capacitor and expose a small `vibe.device.*` SDK; iOS stays PWA | native (3) | M |
| 10 | Payments | checkout in the app | Phase one: the creator pastes their own Stripe keys, function creates Checkout Sessions (Lovable's approach). No Stripe Connect in tier 1 | payments | M, after 2 and 4 |

Cross-cutting, needed by all of the above:

- Secure key entry in the mobile creator app and the chat (write-only; a key pasted into plain chat is detected and moved into the vault).
- A pre-publish scanner that blocks hardcoded keys, private-range fetches and `fetch` calls to unapproved domains in the front end.
- Per-app observability (function logs, error rates, quota use) visible to the creator.
- Per-app caps and a kill switch, because creators will ship abusive apps (phishing, miners, spam).
- Metering and billing through the existing coins and subscriptions.
- An explicit policy for real-money and regulated requests: build a simulator or read-only version and say so, never place orders or move money, add visible disclaimers. This also fixes the silent "no app produced" failures on such prompts.

## 5. Runtime and backend choices (the main decisions)

Functions runtime, with trade-offs:

| Option | For | Against |
|---|---|---|
| Cloudflare Workers for Platforms | Built for untrusted customer code: one isolated Worker per app, per-invocation CPU and subrequest caps, an outbound Worker for egress control, no shared cache; the owner already uses Cloudflare | $25 a month flat plus usage per Cloudflare's published pricing (verify before committing); Workers runtime limits (no arbitrary Node binaries); new operational surface |
| Supabase Edge Functions | Already used; secrets store built in | Not designed as a multi-tenant sandbox for untrusted code; per-project function limits; isolation and egress control would be mine to build |
| Deno subhosting | Purpose built for hosting generated code | Another vendor; less familiar |
| Own sandbox on Fly Machines | Most flexible (any runtime) | Highest cost and security burden; closest to tier 2 |

My recommendation: Cloudflare Workers for Platforms for functions and cron, because it gives tenant isolation and egress control that I would otherwise have to build. Verify pricing and limits with a small spike before committing.

Database: Basely already provisions a schema and role per project and exposes `POST /projects`, `/query`, `/migrations`, `/schema` and API keys, so it can be the per-app database and it dogfoods your own product. Open risks: one-engineer product, plan limits (the Builder plan caps projects per account, so VibeBuild would need a platform plan with no cap), and Postgres connection limits when many small apps connect. Alternative: Supabase or Neon.

Auth: build a minimal magic-link and Google OAuth service first (no password storage); buy only if it grows (Supabase Auth, Clerk or similar). Keep `vibedata` as the zero-configuration tier for tiny apps.

## 6. Sequencing

0. Prerequisite: reliability. Move generation to the direct provider chain, log the outcome and cause of every build, reach a target completion rate on real prompts, and decide the Claude CLI question (see the failover spec). Selling or promoting tier 1 on top of a 36% completion rate wastes the work.
1. Live data and AI: blocks 1, 3, a minimal block 2 (HTTP functions with secrets and egress allowlist), the key scanner and secure key input. Covers about 12 of 27 prompts (live data 10, AI 2; some overlap).
2. Accounts and data: blocks 4, 5, 6. Covers accounts, database and storage prompts (5 of 27) and unlocks multi-user apps.
3. Jobs, notifications, payments by creator keys, device bridge: blocks 7, 8, 10, 9.
4. Later: realtime, containers or arbitrary runtimes (tier 2).

## 7. Changes to the generation pipeline

- A capability planning step before generation (the classification used for the demand analysis becomes a stage): decide which blocks the app needs and what must be asked of the creator.
- The generator needs the SDK surface (`vibe.js`) documented in its context, and must write function code plus front-end calls to it.
- Verification becomes tool-based: run functions locally against mocked secrets (workerd or Miniflare), load the app in a headless browser, call the functions, check for errors. This replaces model judging for backend behavior.
- Ask the creator a question only when something truly blocks the build (a missing API key), as Replit's Plan Mode does, never to avoid work.
- The creator app (iOS and Android) needs: secure key entry, a backend toggle or capability summary, function logs. Client code was not reviewed for this scope.

## 8. Security and abuse (the real cost of tier 1)

Running user-influenced server code is the main new risk. Required controls: per-app isolation (one Worker per app, no shared state), write-only secrets bound only to that app, egress allowlist plus deny of private and metadata ranges, CPU, memory, subrequest and body caps, per-app and per-IP rate limits, per-app spend caps and a kill switch, content scanning and takedown for abusive apps, authorization checks in every function (Lovable's rule: server-side alone is not private), logs retained for abuse review, and data deletion on request.

## 9. Parity snapshot (from vendor docs, not hands-on tests)

| Capability | Replit | Lovable | VibeBuild now | After tier 1 |
|---|---|---|---|---|
| Secrets store | yes | yes | no | yes (block 2) |
| Backend code | yes (containers) | yes (edge functions) | no | yes (functions) |
| Database | yes | yes (Postgres) | key-value only | yes (block 5) |
| End-user auth | yes | yes | no | yes (block 4) |
| File storage | yes | yes | no | yes (block 6) |
| AI in the app | yes (integrations) | via functions | no | yes (block 3) |
| Payments | yes | yes (Stripe) | no | creator keys (block 10) |
| Scheduled jobs | yes | yes | no | yes (block 7) |
| Hosting and custom domain | yes | yes | yes | yes |
| Android package | no | no (PWA, wrap yourself) | yes (APK) | yes, with device bridge |
| Plan mode | yes | chat mode | no | spec-first step |

VibeBuild's edge: a phone-first creator app and a direct path to an installable APK. Tier 1 closes the backend gap underneath it.

## 10. Open decisions for the owner

1. Functions runtime: Cloudflare Workers for Platforms (recommended), Supabase Edge Functions, Deno subhosting, or Fly Machines.
2. Database: Basely (dogfood), Supabase or Neon.
3. First slice: live data and AI (recommended), or accounts and data.
4. Free-tier limits and how usage maps to coins and subscriptions (needs a cost model once volumes are known).
5. Policy for real-money and regulated apps (simulator and read-only only, as proposed?).
6. Whether iOS stays PWA only.
7. Whether a spike to verify Workers for Platforms pricing and limits, and Basely provisioning at app scale, should come before any build.

## 11. Decisions (owner, 2026-10-04) and desk-spike findings

Decisions: functions runtime = Supabase Edge Functions; database = Supabase; first slice = live data and AI (slice 1); real-money and regulated apps = parity with Lovable and Replit ("if they provide it, we do too"); a spike before building = yes.

### 11.1 Is Supabase suitable as a multi-tenant platform for other people's apps?

Yes, used the way Lovable uses it: one Supabase project per app, created through the Management API (Supabase for Platforms: `POST /v1/projects` to create an isolated project, `PUT /v1/projects/{ref}/functions` to deploy functions to it, secrets managed per project or branch). Not suitable: many tenants' functions inside one shared project. Findings from Supabase's documentation:

- Edge Function secrets are project-level environment variables read by every function in that project through `Deno.env.get()`, with no per-function isolation described, and a published cap of 100 secrets per project (48 KiB each). One shared project therefore cannot hold per-tenant secrets safely or at scale.
- Runtime limits: 256 MB memory, 2 s CPU time per request (wall clock 150 s free, 400 s paid), 20 MB function size, 100 / 500 / 1,000 functions per project on Free / Pro / Team. Fine for API calls and glue, not for heavy compute.
- No built-in egress allowlisting for functions, so a tenant's function in its own project can call any host (mitigate with the proxy design below, or with a platform-owned outbound policy).
- Cost: a paid project's compute is about $10 a month (micro: $0.01344 an hour, 1 GB) or about $15 (small), and per the docs only nano supports scale to zero, "available to select customers". So a dedicated project per app has a floor of roughly $10 a month unless Supabase grants a platform arrangement. The documentation I could read does not state free-project limits, pausing behavior, or Management API rate limits; these need to be checked directly.

### 11.2 Slice 1 design that fits these facts

Do not give every app a project in slice 1. Use a declarative API proxy in one platform-owned Supabase project:

- A single `vibe-proxy` Edge Function. Generated apps never ship server code in slice 1; they declare connectors in a manifest (upstream host, allowed paths and methods, where the secret goes: header, query or body) and call `vibe.api('connector', path, options)`.
- Per-app secrets live in our own encrypted table (Supabase Vault or pgsodium), write-only through the secure key entry, decrypted only inside the proxy at request time. This avoids the 100-secret and shared-environment problems.
- The proxy enforces the manifest allowlist, SSRF protection (no private or metadata ranges, no redirects into them, DNS-rebinding safe), response caching for keyless data, per-app and per-IP rate limits, per-app spend caps, a kill switch, and logs.
- The AI proxy and the keyless live-data proxy are the same function with built-in connectors.
- This covers the live-data prompts (10 of 27) and AI-in-app (2) with one shared function, no tenant code execution, and near-zero marginal cost per app.
- Custom server code, SQL, auth and storage (slice 2) do NOT get a project per app at the start. See 11.6 (shared platform first, migrate per app on signals) and 11.7 (migration plan). This replaces the earlier per-app-project assumption, decided by the owner 2026-10-04 because the company is bootstrapped.

### 11.3 Policy for real-money and regulated apps

Owner's rule: parity with Lovable and Replit. What the two publish (read 2026-10-04): Replit prohibits illegal activities such as dealing in drugs, sex, gambling, weapons or pirated software, spam bots, phishing, malware and resource-abusing apps such as cryptocurrency miners; it does not separately name trading or financial tools. Lovable's terms prohibit unlawful use, require independent review of AI output in high-risk contexts including financial ones, and bar uploading payment card data or financial account numbers without a written agreement; it does not name trading or crypto, and refers to separate Platform Rules that I could not read. Lovable's Platform Rules page remains unchecked.

Proposed parity policy: allow read-only financial data, simulators and paper trading, portfolio and expense tools, and bots that use the creator's own broker keys; require a visible "not financial advice, you are responsible" disclaimer and independent-review notice; hard-block gambling and real-money gaming, binary-options style signal services, market manipulation, card or bank account data collection by generated apps, and anything illegal. Open flags for the owner: (a) whether to enable live order execution through creator keys before a legal review (broker, investment-adviser and derivatives rules can apply to whoever operates a service, and some jurisdictions restrict binary options outright; this is a risk flag, not legal advice); (b) Google Play and Apple policies apply to creators who publish their packaged apps to a store; (c) confirm the block list.

### 11.4 Spike (desk part done; hands-on part needs approval)

Desk findings are above. Hands-on spike, about half a day, needing a throwaway Supabase project created through the Management API (a paid micro project costs about $0.0134 an hour, so a few hours is cents, but creating a project is a spend commitment and needs the owner's go-ahead): (1) time to create a project and deploy a function by API; (2) confirm the shared-environment secret exposure with two functions; (3) measure `vibe-proxy` latency, cold start, CPU limit and the SSRF guard; (4) test Vault-based per-app secrets in a shared project; (5) check pause behavior and Management API limits; (6) ask Supabase about platform pricing and scale-to-zero for many small projects.

### 11.5 Hands-on spike results (2026-10-04, Replitor project, all test objects named `spike-*` / `vibe_spike`)

What was run: three JWT-protected Edge Functions (an environment-names probe, a prototype of the slice-1 `vibe-proxy`, a CPU and memory limit probe), a throwaway schema with a connector table, and two dummy Vault secrets (`SPIKE-DUMMY-...`, not real keys). No existing table was read or modified. Environment values were never printed.

Findings:

- JWT enforcement works: a call without an Authorization header returned 401.
- Isolation: every function in the project can read 12 environment variables, including `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS` and `SUPABASE_DB_URL` (direct database access). Confirmed that a shared project can only ever run trusted platform code; a customer's code needs its own project.
- The proxy design works: the function looked up an app's connector, decrypted that app's Vault secret, injected it into the upstream request (the upstream echoed the dummy value back to the function) and never returned it. Two apps used their own secrets. Isolation between apps in a shared project rests entirely on our app-identity check, so the app id must come from a verified token or the Origin of a published app, never from a request parameter.
- Latency from this laptop: first (cold) call 1.14 s; 20 warm calls min 0.51 s, p50 0.85 s, p90 0.94 s, max 1.03 s, for a database lookup (about 340 ms including connect) plus one upstream call (about 340 ms).
- In-memory cache is unreliable: three consecutive calls were all cache misses because each ran in a fresh worker. Response caching must live in the database or an external store, not in function memory.
- SSRF guard: 17 test URLs were decided correctly without making any request to a blocked target, including loopback, link-local metadata, private ranges, IPv6, credentials in the URL, a non-443 port, suffix tricks and decimal, hex and octal IP forms (the URL parser normalizes these). DNS resolution works inside the runtime (`Deno.resolveDns`) and flagged a hostname that resolves to 127.0.0.1, so records can be pre-checked; a small gap remains because `fetch` resolves again afterwards.
- Limits: a 6 second busy loop was killed with HTTP 546 `WORKER_RESOURCE_LIMIT` after about 5.4 s; a memory allocation failed at 240 MB, consistent with the documented 256 MB cap.
- Not tested: creating a project through the Management API (a spend commitment), free-project pausing, Management API rate limits, and the runtime's own outbound network policy (deliberately not probed, to avoid scanning the provider's internal addresses).

Cleanup state: all three functions deleted and verified (the project lists no functions). Still present, pending approval to drop: schema `vibe_spike` (one table, 2 dummy rows, not exposed through the API) and 2 dummy Vault secrets named `vibe_spike/app1/demo` and `vibe_spike/app2/demo`. A cleanup statement was declined by the permission layer and has not been retried.

### 11.6 Shared platform first (owner decision 2026-10-04: one project until volume, then per-app projects)

Rationale: bootstrapped; a project per app costs about $10 a month of compute each (vendor pricing, not re-verified). All slices run on one platform-owned Supabase project, designed so any app can be moved out later. The analysis below is my design reasoning; the isolate runtime and the custom-JWT data API have not been spiked.

Design rules from day one (these are what keep migration cheap):
1. Apps never talk to the database directly. They call our API with an `app_id`. A per-app routing table `app_id -> project, schema, region, runtime` is the only place that knows where data lives. Generated apps never hold database URLs or Supabase keys.
2. One schema per app, no cross-app foreign keys, shared tables or shared sequences. Platform tables (billing, apps, connectors, metering) live in a separate schema. This keeps `pg_dump --schema` possible, and that dump is the migration.
3. End-user auth uses our own per-app JWTs with an `app_id` claim, not Supabase Auth (one user pool per project). Users and sessions then move with the schema.
4. Storage: one bucket, path prefix per app, all access through our API with signed URLs we issue. Moving an app is a prefix copy.
5. Secrets: our own per-app encrypted table, not project-wide Supabase Vault entries. They move with the app.
6. Custom server code (blocks 2, 7, 10) does not run on shared Supabase Edge Functions, because their environment variables (including the service-role key and database URL) are project-wide. Use an isolate-per-app runtime with per-script secrets (candidates: Cloudflare Workers for Platforms, Deno Subhosting; both untested). Our scheduler calls those scripts for cron.
7. Database access for apps: a scoped Postgres role per app, locked `search_path`, `statement_timeout`, row, size and connection caps. Migrations are generated by the agent and applied only by our service, never as raw SQL from the app.
8. Per-app metering from the start (rows, storage bytes, query time, egress, function calls). It drives billing and tells us which apps to move first.

Accepted risks:
- Shared failure domain: a bug in the data API or role scoping exposes every tenant. Launch gate for slice 2: an automated cross-tenant test in which app A tries to read and write app B through every route (data API, storage, auth, functions, proxy). It must pass in CI and before each release.
- Noisy neighbors: caps reduce but do not isolate. Heavy apps are the first to move out.
- Shared project quota: compute and connection limits cap the platform. One larger-compute project is expected to cost far less than many small ones; metering shows when it fills.
- Some creators of regulated or real-money apps will want isolation. Offer a per-app project as an optional paid tier.

### 11.7 Migration plan: shared project to per-app projects

Triggers (any one moves an app; none is a fixed volume):
- One app uses more than about 10% of database CPU, storage or connections over a week.
- A paying customer or regulated or real-money app asks for isolation.
- Shared project p95 query latency or connection saturation passes a threshold we set in the first month (to be calibrated from metering, not guessed now).
- A security incident class that per-app isolation would have contained.

Phases:
1. Prepare (before slice 2 ships): the routing table, schema-per-app and no cross-app references enforced by a CI check, per-app metering, per-app export and import tooling, and a dry-run migration of a synthetic app. Nothing else to do until a trigger fires.
2. Provision: create the target project (Management API or Supabase for Platforms), apply the extensions and roles our API expects, and register it in the routing table as `pending`.
3. Copy: dump the app's schema (`pg_dump --schema`) and restore it into the target while the app keeps running. Copy its storage prefix and its secret rows. Verify row counts and checksums per table.
4. Cutover: a short per-app write freeze (the API returns a retryable error for writes), copy the final delta, flip the routing row to the new project, unfreeze. Reads stay on the old copy until the flip. Expected downtime is seconds to a few minutes for small apps; I have not measured it.
5. Verify and keep a rollback: run the app's health and a data smoke test against the new project; keep the old schema read-only for a retention window (7 days proposed), then drop it. Rollback is flipping the routing row back during the window, with writes made on the new project replayed or accepted as lost only if the owner decides.
6. Bill: the per-app project cost passes through to the plan or the coins system before the first move, so moving an app never loses money.

Order of moves: the heaviest apps by metering first, then any customer who asked for isolation, then regulated or real-money apps. The long tail stays on the shared project.

Not decided: the exact thresholds, whether the isolate runtime also moves per app (probably not, since scripts already isolate), and whether to cap the number of apps on the shared project instead of migrating them.
