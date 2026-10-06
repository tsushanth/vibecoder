# Usage metering, limits and the billing hook (2026-10-06)

Status: metering, caps and the creator Usage panel are built (PR "Usage metering, per-app limits and a creator usage panel"). **Nothing charges coins.** No pricing decision exists, so this document fixes the seam where billing plugs in and lists what the owner must decide. Scope source: `specs/2026-10-04-vibebuild-tier1-building-blocks-scope.md`, cross-cutting items "per-app caps", "per-app observability" and "metering and billing through the existing coins and subscriptions".

## What is recorded now

One compact rollup table, `platform.usage_daily(app_id, day, kind, calls, errors, bytes, row_count, ms, spend_micros)`, migration `009_usage.sql`. One row per app, day and kind, updated by upserts, so it stays a few dozen rows per app per month. It holds counts, bytes, milliseconds and spend only: never request bodies, row contents, emails, tokens or secrets. Rows older than 90 days are purged daily by the proxy. `platform.usage_events` (the per-call log for connector and AI calls) is unchanged.

| kind | recorded when | counters used |
|---|---|---|
| `api` | a connector call (including those made by scheduled jobs) | calls, errors, bytes (response), ms |
| `ai` | an AI call; spend is added when the cost is known | calls, errors, bytes, ms, spend_micros |
| `db` | every data API request | calls, errors, row_count (rows returned or affected), ms |
| `storage_upload` | an upload | calls, errors, bytes (stored, successful only), ms |
| `storage_download` | a signed download URL request | calls, errors |
| `storage_other` | list and delete | calls, errors |
| `auth_email` | a sign-in link request | calls, errors (calls minus errors is "emails sent") |
| `auth_signin` | a link consumed | calls, errors |
| `auth_session` | `me` and `signout` | calls, errors |
| `notify` | `notify/me` | calls, errors (calls minus errors is "emails sent") |
| `job` | a finished scheduled job run (skipped counts as a call, not an error) | calls, errors, ms |
| `pay_checkout`, `pay_orders`, `pay_webhook` | the pay routes | calls, errors, ms |

Events are merged in memory and written every `USAGE_FLUSH_MS` (default 5000 ms, `0` = write each one at once) and on shutdown, so a hard crash can lose up to that window. A request for an unknown app (404) is never metered.

## Limits

Defaults live in `platform/vibe-proxy/usage.js` (`LIMIT_DEFS`) and the proxy config; `platform.app_limits(app_id, overrides jsonb)` overrides them per app. Overrides are validated (known keys, integer, in range) and can only be written through `POST /admin/apps/:app/limits` with body `{ "overrides": { ... } }`, which replaces the whole set (`{}` clears it). `GET /admin/apps/:app/limits` returns `{ defaults, overrides, limits }`.

| key | default | enforced by | at the cap |
|---|---|---|---|
| `rowCap` | 20,000 rows across all the app's tables | data API insert (cheap `count(*)` over the app's tables) | 413 `row_cap` with a short message; fails closed (503 `limits_unavailable`) if the count cannot be taken; reads, updates and deletes still work |
| `dailyCalls` | 5,000 (`DAILY_CALLS`) | limiter | 429 `daily_call_cap` until midnight UTC |
| `dailySpendMicros` | 50,000 = $0.05 (`APP_AI_DAILY_MICROS`) | limiter | 429 `spend_cap` until midnight UTC |
| `storageBytes` / `storageFiles` | 200 MB / 2,000 | storage upload reservation | 413 `quota_bytes` / `quota_files` |
| `emailsPerDay` | 200 (`NOTIFY_APP_PER_DAY`) | auth sign-in links and notifications, each against its own per-app daily counter | 429 `rate_limited` |
| `jobRunsPerDay` | 300 | job scheduler | the run is skipped with `daily_cap` until tomorrow |

`GET /admin/apps/:app/usage?days=1..30` returns `{ days: [{ day, byKind }], totals, limits, usage }`; `usage` is current use against those caps (`rows`, `storageBytes`, `files`, `callsToday`, `spendMicrosToday`, `emailsToday`, `jobRunsToday`; `null` when a figure cannot be read right now). The backend's `GET /api/projects/:id/usage?days=7` (verified project owner only) merges the project's preview and published apps: days and totals are summed, `limits` and `usage` are the published app's (else the preview's), because caps apply per app.

## Known gaps in the caps (be aware before relying on them for billing)
- `emailsPerDay` is applied to the sign-in and notification counters separately, so one app can still send up to twice the number per day. A single shared counter is a small follow-up.
- The row cap is checked before the insert, not inside it: concurrent inserts can overshoot by a few rows. It is a guard rail, not an accounting boundary.
- A cap override is cached for up to 30 seconds per proxy instance (the instance that handled the admin call refreshes at once).
- Usage events are not written transactionally with the request. Treat the rollup as accurate to well under 1% for pricing purposes, not as an audit log.

## The existing coins and subscriptions system (what billing has to fit)
- Coins: `coinService.js` and `database_migration.sql` (`spend_coins(user, amount, reason, project, creator, platform)`, atomic, records a `coin_transactions` row and credits the creator 55% when `creator_id` differs). Fixed costs today: generation 20, tweak 10, fork 10; packs of 100/500/1200 coins at $0.99/$3.99/$7.99. **`routes/coins.routes.js` is not mounted in `server.js`**, so the coin store, spend and earnings endpoints are not reachable today. `spendCoins` also trusts `userId` from the request body and derives the amount from `reason` (an unknown reason costs 10), so it must not be exposed as is.
- Subscriptions: `subscriptionService.js` (mounted at `/api/subscriptions`): tiers Free (10 generations a day, 3 tweaks per project, no private projects), Pro $9.99/month and Team $29.99/month (unlimited generations and tweaks). `checkUsageLimit` and `recordUsage` gate generation, tweak, fork and private-project actions. Nothing in it knows about running apps.

## How usage maps onto them (the hook)

The hook is `billableUnits(totals)` in `platform/vibe-proxy/usage.js`: a pure function from a usage report's `totals` to units, with no prices. It is not called by anything that charges. Units:

| unit | meaning |
|---|---|
| `requests` | all request-style calls (everything except job runs and Stripe webhooks) |
| `aiSpendMicros` | provider cost of AI calls, in millionths of a dollar |
| `dbRowsReturned` | rows returned or affected by data requests |
| `uploadBytes` | bytes uploaded |
| `downloads` | successful signed downloads |
| `emailsSent` | sign-in links plus notifications that were sent |
| `jobRuns` | scheduled job runs |
| `payCheckouts` | successful checkout sessions |

Gauges are not summed over time: stored rows, stored bytes and stored files come from the report's `usage` at the end of the period.

Proposed wiring, when the decisions below are made (not built):
1. A daily job in the backend (or a Cloud Scheduler style cron) lists projects with a published app, reads yesterday's totals per app through `proxyAdmin.getUsage(app, 2)` (the same project-to-app resolution as the usage route, `lib/appSubdomains.js`), and runs `billableUnits`.
2. A rate table (owner decision) converts units above the plan's free allowance into coins. The charge goes through a NEW server-side function that calls the `spend_coins` RPC with a new reason such as `app_usage`, the creator as `p_user_id` and no `creator_id`: the 55% creator share must not apply to the platform's own infrastructure costs. It must not reuse `POST /spend` (client-supplied user and fixed amounts).
3. Idempotency: a `usage_charges(project_id, day, units jsonb, coins, charged_at)` table with a unique key on `(project_id, day)` so a re-run never double charges.
4. Free allowance and tier: `subscriptionService` gets a per-tier `appUsage` allowance next to `dailyGenerations`; Pro and Team would raise the caps by writing `platform.app_limits` overrides through `POST /admin/apps/:app/limits` when a project's creator upgrades, which is how "paying for more" reaches enforcement.
5. The Usage panel already shows the numbers; add a "coins this period" line when charging exists.

## Decisions the owner must make
1. **Price per unit.** Which units are charged at all (suggestion: AI spend at cost plus a margin, email sends, storage above the allowance; leave requests and rows free, they are a safety cap, not a product). Coins per unit or dollars per unit?
2. **Free allowance.** Per account, per project or per app, and per tier (Free, Pro, Team). Today's defaults (20,000 rows, 200 MB, $0.05 a day of AI, 200 emails a day) are abuse caps, not allowances.
3. **What happens at the cap.** Today: fail closed with a clear message in the panel, and the creator asks the team to raise it (nothing automatic). Options: automatic raise while the coin balance lasts; raise on upgrade; hard stop. Also what happens when a creator's balance is empty: pause the app's paid features, or let usage run and bill later (risk: negative balances and abuse).
4. **Who pays.** The creator (assumed here), or the end users of a published app; and whether the 55% creator share on generation spend still applies to usage charges (this plan says no).
5. **Granularity and timing.** Daily settlement (proposed) or per period; whether the creator gets a warning before charging starts (the 80% warning state exists in the panel).
6. **Mounting the coin system.** `coins.routes.js` is not mounted and `spend` is unauthenticated; decide whether coins are the unit at all or whether usage is simply folded into the subscription price.
