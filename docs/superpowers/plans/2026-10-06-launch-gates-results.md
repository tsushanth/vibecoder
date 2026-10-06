# Launch gates: results (2026-10-06)

The two launch gates promised in `2026-10-05-slice2-accounts-data-storage-plan.md`: the cross-tenant suite and the load / connection-budget check.
Both run only against a local scratch Postgres with fake mail, R2, Stripe, upstream and AI fetches. Nothing here touched the live proxy,
the production Supabase project, box 231, or any migration.

Bottom line:
- **Gate 1 (cross-tenant): green. No leak found.** 7,908 matrix cells plus 496 CORS cells, 42 routing-trick cells and the database-level checks. 19 of 19 deliberate security mutations make it fail.
- **Gate 2 (load): found one real defect, fixed it.** Under overload the proxy queued requests without bound: hangs, then 500s, and it had not recovered minutes after the load stopped. It now refuses with a clean 503 and recovers immediately. The connection budget itself was never exceeded.
- **Capacity is much lower than the headline local number once the database is remote.** About 2,700 requests/s with a database at 0 ms, about 140/s at 2 ms per statement, about 32/s at 10 ms per statement. Each request costs 7 to 22 database statements. Read the caveats before quoting any number.

## How to run

```
cd platform
PGHOST=localhost PGPORT=5544 npm test                       # includes both gates (cross-tenant + a small load smoke test)
PGHOST=localhost PGPORT=5544 node gate/mutation-check.mjs   # breaks 19 controls one at a time; each must make the gate fail (about 4 minutes)
PGHOST=localhost PGPORT=5544 node gate/load.mjs --users 1,5,10,20,40,80,160 --apps 4 --duration 6 --db-latency 2
PGHOST=localhost PGPORT=5544 node gate/load.mjs --mode open --rps 20,30,45,70,150,400 --duration 15 --db-latency 10
```
Tests skip (not fail) when no local Postgres is reachable. Options for `load.mjs` are in its header.

## Gate 1: cross-tenant suite

Files: `platform/gate/harness.mjs` (boots the real `startServer` through a restricted non-inheriting login, production `makePool`), `gate/fixture.mjs`
(two tenants), `gate/matrix.mjs` (the table), `gate/test/cross-tenant.test.mjs`, `gate/mutation-check.mjs`.

**Fixture.** Apps A and B. Each has four end users (u1, u2, a user whose session was revoked, a user whose session row was deleted), tables of every
access mode (owner, public_read, authenticated, private) with rows from two users, a private and a public file, a signed Stripe order plus an order
naming the other tenant's user as buyer, a notify opt-out, a job, three secrets, a manifest with a connector and a pay catalog, and a custom domain.
Every value is a unique canary.

**Matrix.** Run in both directions (A attacks B, then B attacks A) so each tenant is attacker and victim. Attacker identities (24: 18 general and 6 near-miss admin tokens used only on admin routes):
anonymous; a user of the attacker's own app (carrying the victim's ids in payloads); the attacker's token on the victim's URL; the token with its
`app_id` claim rewritten; wrong signing key; `alg: none`; expired but signed with the victim's key; signed with a key derived for the attacker's app;
revoked session; session row deleted; the last two again on the attacker's own app; four "leaked key" forgeries that isolate each verification layer
(unknown jti, claim for the other app, other app's session jti, sub mismatch); garbage; oversized; and the six near-miss admin tokens (no `Bearer` prefix, lowercase scheme, leading space, token plus a suffix, truncated, empty).

Route families (derived from exports, see coverage below): `/auth` request, consume (with the other app's link), me, signout; `/db` select, insert,
update, delete on all four access modes, plus user_id spoofing in where, set, rows and as a top-level key, 31 table-name abuses (schema-qualified, SQL-ish,
prototype names, wrong types), 17 column-name abuses each in where/order/columns, operator and op abuse, SQL injection in values, peer-row writes inside one
app; `/storage` upload (with path-traversal names), list, url, delete with the victim's file ids (private and public) and id abuse, and the peer's private file;
`/notify/me` with spoofed recipient fields, `/notify/unsubscribe` GET and POST with the other app's token; `/pay` checkout, orders, webhook (signed with the
attacker's secret, unsigned, signed with the master key); `/api` and `/ai` (public by design: asserts the victim's own key is used and never returned);
22 admin operations including copy-secrets in both directions, usage and limits (added by #47 while this was in review: the coverage guard failed on the rebase until they were covered); CORS preflight and POST from the other app's subdomain and custom domain plus look-alike origins.

Every cell states an exact expected status (and error code), and is checked for:
no victim canary (email, user id, row value, file id or name, object key, order id, job id, schema or role name, token, secret) and no admin token, master key, R2 or
mail key in the response body or headers; no mail to a victim address; the expected number of R2, Stripe and upstream calls; and operation-specific checks
(for example the R2 object key must start with `<app>/<user>/`). After each direction a full snapshot of the victim (all four tables, end users, sessions,
files, orders, opt-outs, jobs, secrets by hash, app row, schema spec) must be byte-identical. The captured proxy logs (about 7,900 lines) contain no canary.
Positive controls prove the routes are live and the detector sees real data (legitimate users get their own data; the detector flags it).

| | cells |
|---|---|
| matrix A->B | 3,954 |
| matrix B->A | 3,954 |
| CORS A->B / B->A | 248 / 248 |
| routing tricks (path, query, header, encoding) A->B / B->A | 21 / 21 |
| skipped, each with a stated reason (signout is idempotent for validly signed tokens) | 10 |
| operations in the table | 211 |

**Database level.** As each app role, directly on the connection: select, insert, update, delete, truncate, drop and alter on every table of the other app; create table in
the other schema, `platform`, `public`; drop the other schema; create schema and role; alter the other role; every `platform.*` table (select, delete, insert);
`provision_app_db`; `pg_authid`, `pg_shadow`, `copy ... to program`, `pg_read_file`, `lo_import`. All denied by Postgres itself (42501). The proxy login has no direct access to any
tenant schema. The executor refuses 29 role-changing or multi-statement shapes before they reach the database. Role and schema names are database-derived and
unique per app.

**Coverage guard.** The test derives the route list from the exported `ROUTE` regexp (server), `AUTH_OPS`, `STORAGE_OPS`, `PAY_OPS`, `NOTIFY_OPS` and `ADMIN_SUBS` (the last two
exports were added for this) and fails if any route has no matrix operation. A second test greps `server.js` for the exact set of top-level dispatch sites and the number
of `url.pathname` tests, so a new family or branch forces a decision.

**Mutation check** (`gate/mutation-check.mjs`, patches the real source, runs the gate, always restores): 19 of 19 caught.

| broken control | caught by |
|---|---|
| user_id ownership predicate in the query builder | matrix (both directions) |
| token `app_id` claim check | matrix, routing, state |
| JWT key no longer bound to the app id | matrix, routing, state |
| session lookup not scoped to the app | matrix |
| login-link consume not scoped to the app | matrix, injected-links check |
| storage object key loses the app prefix | matrix |
| storage get not scoped to the app / delete not scoped to the owner | matrix |
| role switching: all apps reuse the first role | matrix, database level, executor |
| role switching: no `SET ROLE` | matrix and most other tests |
| executor statement filter disabled | executor test only (see observations) |
| admin token check always passes | matrix and more |
| CORS origin check open in server, notify, pay (3 mutations) | CORS tests |
| webhook accepts events naming another app | matrix |
| orders not scoped to the app | matrix (needs the foreign-reference order) |
| unsubscribe token not bound to the app | matrix |
| notify recipient taken from the request body | matrix |

Two mutations survived the first draft (orders and storage-delete scoping); both were real gaps in the matrix, closed by adding the foreign-reference order and the
same-app peer-file cases, and the check now runs clean. Several controls are defence in depth with overlapping layers (token claim, key derivation, session scope), so a
single mutation is only caught because the matrix includes forgeries that isolate each layer (the "leaked key" identities).

**Leaks found: none.** Observations, none a cross-tenant leak, none changed here:
1. The CORS check compares hostnames only, so `https://app-b.vibebuild.cc:8443` is accepted for app-b. It is the app's own host on another port; low risk, but a strict origin match would be cleaner.
2. `public_read` tables return the author's `user_id` with every row to anyone. By design, but it means user ids are public wherever a public table exists.
3. An anonymous caller can tell real table names from fake ones (400 `unknown_table` versus 401/403), and an anonymous caller gets 400 before 401 for malformed ops. Low value for an attacker.
4. At the database level an app role can `SET ROLE` into another app role (Postgres checks the session user, which holds SET on all of them). `isSafeStatement` in the executor is the only barrier,
   and the query builder never emits such a statement, so it is not reachable over HTTP today. It is the one control with no second layer, and only one test guards it. Worth a second layer later (for example a per-request low-privilege login, or a statement allowlist at a pooler).
5. `signout` answers 200 for any validly signed token, even for a revoked session or an unknown jti (idempotent), so it cannot be used to probe session state, but it also reports success when nothing was revoked.
6. Admin header whitespace: Node trims trailing whitespace from header values, so a token with a trailing space is the real token. Not an issue, noted because a draft of the matrix tripped on it.

Caveat: the gate proves what it enumerates. It does not cover the generated app code (XSS in an app), DNS or TLS routing in front of the proxy, the VibeBuild backend that calls `/admin`, Supabase's own anon-key exposure, or anything that
needs real third parties (Stripe, R2, Resend).

## Gate 2: load and connection budget

**Setup.** `gate/load.mjs` forks `gate/load-server.mjs` (the real proxy in its own process) so the generator's CPU does not inflate the server's latency. Production pool settings through
`makePool` (`DB_POOL_MAX` 5, 5 s connect/queue timeout, 30 s idle timeout). The proxy logs in as a fresh role created `login in role vibe_proxy connection limit 8` (verified in the test via `pg_roles`).
4 apps x 25 users, each user with a pre-minted session and a file. Virtual users mix: me 14, db_read 34, db_write 20, db_public 10, storage_list 6, storage_url 6, upload 4, notify 4, sign-in 2 (percent). Every call uses its own client IP so per-IP
limits do not mask results; app limits are lifted except in the last scenario. Mail, R2 and Stripe are fakes with 30 ms latency. Metrics: client-side latency percentiles, outcome by status, `pg_stat_activity` sampled every 15 ms for the proxy login,
time to acquire a pooled connection (instrumented on `pool.connect`), peak pool queue, event-loop lag, database statements per request, recovery probe after the burst, and a leak check (`total - idle` clients after the burst).
The database is local, so an optional `--db-latency` adds a fixed sleep to every statement while the connection is held, to stand in for a remote database.

**Cost of a request (database statements, each takes a pooled connection; median of 7 calls).**
me 7, db_public 14, db_read 15, db_write 22, storage_list 8, storage_url 8, upload 12, notify 14, sign-in 20 (request plus consume). The mix averages about 14.
(db_write was 15 before the metering and row-cap change #47 landed mid-task; capacity fell about 12 percent with it. Re-measure after any change that adds per-request queries.)
Where they go: app lookup 1, limiter 4 to 5 (kill switch, per-IP, per-app, daily), session check 1, and for data calls a 7-statement transaction (begin, four `set local`, the query, commit) plus a spec lookup.
This is the main lever on capacity (see recommendations).

**Saturation, closed loop, local database (about 0.1 ms per statement), 6 s per step, `MAX_INFLIGHT` raised to 5,000 so nothing is shed.** Throughput peaks at about 2,700 req/s from 20 users and stays flat; more users only add queueing.
(With the shipped default cap of 50, users beyond 50 in a no-think-time loop get instant 503s and spin; that is the cap working, and why the capacity runs lift it.)

| users | req/s | p50 ms | p95 ms | p99 ms | pg conns max | pool wait p99 ms | failures |
|---|---|---|---|---|---|---|---|
| 1 | 199 | 1.9 | 33 | 34 | 2 | 0.01 | 0 |
| 5 | 1,138 | 1.5 | 32 | 33 | 5 | 0 | 0 |
| 10 | 2,112 | 1.9 | 32 | 33 | 5 | 0.2 | 0 |
| 20 | 2,691 | 4.5 | 35 | 37 | 5 | 0.7 | 0 |
| 80 | 2,660 | 27 | 63 | 72 | 5 | 4.4 | 0 |
| 320 | 2,539 | 121 | 179 | 223 | 5 | 20.5 | 0 |
| 640 | 2,544 | 246 | 330 | 421 | 5 | 37.9 | 0 |

(The 32 ms p95 floor is the 30 ms fake mail latency on notify.) At this speed the proxy is CPU-bound on one core and the pool is never the limit. The 5-connection pool was fully used from 5 users, and Postgres
never saw more than 5 connections from the proxy login in any run (role limit 8).

**With a remote database.** Same mix, closed loop, cap lifted. Capacity is set by the pool: roughly `5 / (14 statements x round trip)`.

| simulated round trip | max throughput | p50 at 10 users | p95 at 40 users | p95 at 160 users |
|---|---|---|---|---|
| 0 ms (local) | about 2,700 req/s | 1.9 ms | 44 ms | 101 ms |
| 2 ms | about 141 req/s | 67 ms | 364 ms | 1,375 ms |
| 10 ms | about 32 req/s | 303 ms | 1,560 ms | 6,116 ms |

No errors in these closed-loop runs: users just wait their turn. A real browser will not wait 5 seconds, so the closed-loop latency at overload is a floor, not a promise.

**Overload, open loop (arrivals keep coming whether or not the proxy keeps up), 10 ms round trip.** Capacity is about 32 to 37 req/s depending on the code version.

Before the fix (measured on the code before #47, 20 s steps, capacity about 37 req/s):

| offered req/s | 2xx % | timeouts at 15 s (client) | 500s | pool queue max | pool wait max |
|---|---|---|---|---|---|
| 30 | 100 | 0 | 0 | 1 | 14 ms |
| 45 | 100 (p95 6.4 s) | 0 | 0 | 257 | 0.8 s |
| 70 | 44 | 802 | 0 | 908 | 2.7 s |
| 150 | 7 | 2,840 | 154 | 2,736 | 5.0 s |
| 400 | 0 | 3,591 | 3,073 | 4,447 | 5.0 s |

What failed first and how: **hangs, not errors.** The pg pool queue has no bound, so latency grew without limit (3 to 8 s at 20% over capacity, past 15 s at 2x), with **no error at all**. Each request takes about 12 sequential connections
and each wait can be up to the 5 s pool timeout, so a request can live for a minute. Only at 150 req/s and above did the pool timeout turn into 500s, and the limiter, which also needs a connection, started failing closed (429s). Worse, the abandoned
requests kept running server-side: 3 seconds after a 20 s burst ended, recovery probes still failed (p95 6.8 s, a 500 and a timeout) and the pool had shrunk to 2 clients. In production that is a retry storm waiting to happen.

The fix (separate commit, regression test `proxy-app/test/overload.test.mjs`, `MAX_INFLIGHT`, default 10 x `DB_POOL_MAX`): admission control in `server.js`. Past the cap, new requests get an immediate `503 {"error":"overloaded"}` with `Retry-After: 1`; `/health` and `/admin` are never refused.
The regression test hangs on the unfixed code (refused requests wait for the database), and the load smoke test fails on it (500s and timeouts).

After the fix (rebased on #47, 15 s steps):

| offered req/s | served ok/s | 503 (clean refusals) | 500 | client timeouts | p95 / p99 over all requests ms | pool queue max |
|---|---|---|---|---|---|---|
| 20 | 20.1 | 0 | 0 | 0 | 244 / 248 | 1 |
| 30 | 30.3 | 0 | 0 | 0 | 274 / 325 | 5 |
| 45 | 31.4 | 177 | 0 | 0 | 1,866 / 2,371 | 46 |
| 70 | 32.5 | 549 | 0 | 0 | 1,797 / 2,332 | 46 |
| 150 | 31.6 | 1,780 | 0 | 0 | 1,728 / 1,955 | 47 |
| 400 | 33.4 | 5,592 | 0 | 0 | 1,394 / 1,770 | 46 |
| 1,000 | 32.7 | 14,791 | 0 | 0 | 2 / 1,619 (refusals are instant) | 46 |

Served throughput stays flat at capacity instead of collapsing, nothing hangs, nothing 500s, the queue is bounded, and after the 15 s bursts plus 3 s settle the probes ran at baseline (p50 167 ms, p95 249 ms against 164 / 244 at light load, zero failures, pool 5 total / 5 idle / 0 waiting, no leaked client).
Admitted requests still see 1 to 2 s at the cap of 50 with a 10 ms round trip (cap divided by capacity). Lower `MAX_INFLIGHT` trades more 503s for lower latency.

**Connection budget.** Peak Postgres connections for the proxy login were 5 in every run with `DB_POOL_MAX=5` (role limit 8); the pool never exceeded its max and `total == idle` after every burst (no leak). Misconfiguration test: `DB_POOL_MAX=12` against the role limit of 8 at 40 users:
Postgres capped the role at 8 connections (budget held) but **2,444 of 12,679 requests (19 percent) were 500** (`too many connections for role`) and the rest queued. Nothing validates `DB_POOL_MAX` against the role limit.

**Default limits.** With the shipped defaults (30 per IP per minute, 120 per app per minute) 4 apps and 20 users got 40,929 clean 429s and 477 successes in 6 s, and recovery probes within the same minute are 429 as well. Clean and cheap (about 6,900 req/s of refusals, p99 7 ms), but see the recommendations: these defaults were chosen for the connector and AI proxy and now also gate `/db`, `/auth` and `/storage`.

## Recommended limits

1. **Keep `DB_POOL_MAX` at 5 (at most 6 or 7) while the proxy's database role has `connection limit 8`**, and make the rule explicit: machines x `DB_POOL_MAX` must stay below the role limit, with one spare for migrations and `psql`. `fly.toml` has no machine cap and `auto_start_machines = true`; a second machine means 10 connections against a limit of 8 and the failure mode above. Pin a single machine or lower the pool per machine, and set `[http_service.concurrency]` explicitly. The shared project allows 60; the proxy at 5 is well inside.
2. **Keep `MAX_INFLIGHT` at its default 50 for now**, and lower it (20 to 25) if the measured database round trip is 10 ms or more, so admitted requests do not wait over a second. Rule of thumb: cap = capacity (req/s) x acceptable latency (s). Slow connector calls (up to 15 s) hold a slot without using the database, which is why it is not set lower.
3. **Plan capacity from round trips, not from the local number.** About `5 / (14 x RTT)` requests per second: roughly 140/s at 2 ms, 32/s at 10 ms. Measure the real proxy-to-database round trip before launch day; if it is above about 5 ms, the next win is fewer statements per request, not more connections. The obvious candidates: fold the limiter's four to five counters into one statement, and run the executor's transaction setup in one round trip (`set_config` calls in a single query) instead of seven. That should multiply capacity several times and needs no new connections.
4. **Per-app and per-IP request limits.** The defaults (120 per app per minute, 30 per IP per minute) cap an entire app at 2 requests per second and one user behind one address at one request every 2 seconds, which a real data-backed page will exceed. They also bear no relation to capacity: at 10 ms the whole proxy serves about 1,900 requests per minute. Suggested starting points, decided by the owner: per IP 120 per minute for data routes, per app no more than about a quarter of measured capacity per minute (about 450 per minute at 10 ms, about 2,000 at 2 ms), and keep the daily call cap. Keep the stricter numbers on `/ai`.
5. **Sign-in cap.** 200 magic-link requests per app per day is hard-coded in the auth service (not configurable); the load test hits it within seconds. Decide whether that is the intended launch number, and make it configurable if it is not.
6. **Alert on** `shed` events (log lines with `route: "shed"`, status 503), on pool wait, and on `53300` database errors, since those are the early signs of this saturation.

## Caveats (read before quoting numbers)

- Laptop (Apple M2 Pro, 10 cores, Node 26) and Postgres 17.8 on loopback, generator and proxy as separate processes on the same machine. The 2,700 req/s figure is a one-core ceiling on a much faster CPU than the Fly `shared-cpu-1x` 256 MB machine in `fly.toml`; expect far less there, and memory was not measured.
- No network. The 2 ms and 10 ms rows are a fixed sleep per statement, with no jitter, TLS, pooler hop or packet loss. The real proxy-to-Supabase round trip has not been measured, and it decides the capacity.
- Fake mail, R2, Stripe, upstream and AI with a constant 30 ms. Real providers have variance and failures; slow upstreams hold in-flight slots.
- One proxy instance and a scratch database with no other tenants. A noisy neighbour on the shared project, replication, autovacuum and the 60-connection pool are not modelled. Scale-to-zero cold starts were not measured.
- The mix is a guess. Capacity scales with the mix; heavy sign-in or data-write traffic costs more statements per request (20 and 22).
- Closed-loop numbers overstate how patient real users are. The open-loop runs are the honest overload picture. Open-loop steps were 15 to 20 s; a longer soak (minutes to hours) and pool behaviour across the 30 s idle timeout were not run.
- Cross-tenant: see the caveat at the end of Gate 1.
