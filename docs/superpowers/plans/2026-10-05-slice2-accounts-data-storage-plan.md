# Slice 2 plan: end-user accounts, SQL data, file storage (2026-10-05)

Scope source: `specs/2026-10-04-vibebuild-tier1-building-blocks-scope.md` blocks 4, 5, 6 and the shared-platform rules in 11.6/11.7. This plan fixes the design and build order. Nothing here is built yet.

## Principles carried over
- Generated apps never hold database URLs or keys and never ship server code in slice 2. They call the proxy (`vibe-proxy.vibebuild.cc`) with their app id; the proxy is the only thing that touches the database.
- One Postgres schema per app, no cross-app references, platform tables in `platform`. `pg_dump --schema` is the migration path (11.7).
- Our own per-app JWTs, not Supabase Auth. Reads and writes use the existing restricted login `vibe_proxy_app`; never the service-role key.
- Private-by-default: a table is only readable or writable by others if its declared rule says so.

## Design

### Accounts (block 4)
- `vibe.auth.signIn(email)` sends a one-time magic link; `vibe.auth.session()`, `vibe.auth.signOut()`. No passwords. Google sign-in is a later add.
- Token: HS256 JWT, claims `app_id`, `sub` (end-user id), `exp` (30 days, sliding refresh), `jti`. Signing key per app derived with HKDF from a platform master key plus the app id, so a leaked token never validates on another app and keys move with the app. The proxy rejects any token whose `app_id` differs from the request's app id.
- Tables (in `platform`, RLS on): `end_users(app_id, id, email, created_at)`, `login_links(token_hash, app_id, email, expires_at, used_at)`, `sessions(jti, app_id, user_id, revoked_at)`. Links are single use, 15 minutes, stored hashed.
- Abuse limits: per-IP, per-email and per-app send caps; per-app daily cap on emails; kill switch already exists (`enabled`).
- Magic links need an email sender (open decision 1).

### SQL data (block 5)
- Creators and the agent never write raw SQL for apps. The generator emits `vibe.schema.json`: tables, typed columns, indexes, and a per-table access rule: `owner` (rows visible and writable only by the creating user, default), `public_read` (anyone reads, owner writes), `authenticated` (any signed-in user), `private` (no client access).
- The service validates the file and applies migrations itself, in a transaction, as the app's role. Additive changes apply automatically; destructive ones (drop column or table, type change) are refused unless the creator confirms.
- Runtime API: `vibe.db.from('todos').select/insert/update/delete` with filters, ordering, limit. The proxy turns this into parameterized SQL inside one transaction that does `SET LOCAL ROLE app_<id>`, locks `search_path`, sets `statement_timeout`, and injects the ownership predicate and `user_id` itself. Client-supplied identifiers are checked against the schema allowlist; values are always bound parameters.
- Caps per app: rows, bytes, request rate, query time, result size. Metered into `usage_events`. Connection budget: the proxy pool already holds at most 5 of the 8 connections `vibe_proxy_app` may use, so concurrency is capped by design.
- One role per app (`NOLOGIN`, granted to `vibe_proxy_app`), owning only its schema.

### Storage (block 6)
- `vibe.storage.upload(file)` returns a signed URL; `vibe.storage.url(path)`. Objects live under `app_id/` in one bucket; the proxy issues signed upload and download URLs after checking the app JWT and the caller's ownership.
- Quotas: per-file size, per-app total bytes, MIME allowlist (images, pdf, text, audio, short video). Serve with `Content-Disposition` and `nosniff`; user uploads are never served from the app's own origin as HTML.
- Backend choice is open decision 2.

### Generation pipeline
- Capability planning step decides whether the app needs accounts, tables, storage and states them to the generator; SDK docs for the new calls are added to the worker rules; the scanner learns the new SDK calls. Browser check runs against a stub proxy that serves auth, db and storage in memory so generated apps are verified before publish.

## Build order (each step test-first, mutation-checked, deployed and verified before the next)
1. **Schema and roles:** migration 002 (end_users, login_links, sessions, app_schemas, app_quotas), role creation helper, routing table `app_id -> project, schema`. Platform CI check: no cross-schema foreign keys.
2. **Auth core:** key derivation, JWT issue/verify, link issue/consume, sessions, limits. Proxy routes `/auth/*`. SDK `vibe.auth`.
3. **Data API:** schema file validator, migration applier, query builder with ownership injection, role/transaction wrapper, caps and metering. Routes `/db/*`. SDK `vibe.db`.
4. **Storage:** signed URL issuing, quotas, routes `/storage/*`, SDK `vibe.storage`.
5. **Cross-tenant gate:** an automated test in which app A, and an anonymous caller, try to read and write app B through every route (auth, db, storage, proxy) and with forged, expired and other-app tokens. Must pass in CI and before every deploy. Also a SQL-injection and identifier-abuse suite for the query builder.
6. **Generator + scanner + stub proxy** wiring, then a real end-to-end build of a todo app with accounts, a table and an upload, verified in a browser against the live proxy.
7. **Migration dry-run:** export and import tooling for a synthetic app (11.7 phase 1).

## Launch gates
- Cross-tenant suite green; injection suite green.
- Real E2E on the live proxy with two test apps and two users each.
- Load check against the 8-connection budget and the Replitor `max_connections` of 60.
- Quotas and kill switch verified live.

## Decisions I need from the owner
1. **Email sender for magic links** (also used by slice 3 notifications). Recommend Resend on a dedicated sender domain such as `mail.vibebuild.cc` with SPF/DKIM, platform-owned, capped per app. Alternative: Supabase Auth email is not an option here because we do not use Supabase Auth.
2. **Storage backend.** Recommend Cloudflare R2: free 10 GB, no egress fees, and its S3 keys are scoped to the bucket, so no service-role key is needed. Alternative: Supabase Storage through its S3-compatible endpoint, which keeps one vendor but costs egress and shares the shared project's quotas.

Defaults if you do not object: Resend and R2.

## Risks
- Shared failure domain: a bug in role scoping or the query builder exposes every tenant. The cross-tenant gate is the control, not a nice-to-have.
- Replitor connection limit (60) is shared with other apps; the proxy pool cap keeps us inside our budget but a noisy neighbor can still starve us.
- Magic-link email abuse (spamming third parties through our sender) is the main reputation risk; hence the tight per-email and per-app caps.
- The per-app JWT design has not been load tested, and the query builder is the largest new attack surface.
