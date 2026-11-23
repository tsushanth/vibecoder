# Securing POST /api/projects/generate (userId in the body)

Status 2026-11-23: code written, tests pass, NOT deployed. The flag defaults to `report`, which changes nothing for any client.

## The hole

`POST /api/projects/generate` used the `userId` from the request body without proving it. User ids are not secret, so anyone who
knew or guessed one could start builds (and use that user's fair-use quota) as that user.

## What the gate does (backend/lib/generateAuth.js)

`GENERATE_AUTH_MODE` is read on every request. Unset or unrecognised means `report`.

| Mode | Behaviour |
|------|-----------|
| `off` | Nothing runs. No lookup, no counting. |
| `report` (default) | Behaviour unchanged for every request. Each request is classified in the background (never awaited, cannot fail or slow a request) and counted. |
| `enforce` | 401 `{"error":"Sign in again to start a build.","code":"auth_required"}` unless the caller proves the user (below). The check runs before any other work. |

A request is allowed in enforce mode when ONE of these holds, checked in this order:

1. `internal_ok`: a valid internal signature (below) for the body `userId`.
2. `token_match`: `Authorization: Bearer <access token>` verifies (same `verifiedUserId` helper the other routes use) and the token's user equals the body `userId`.

Everything else is refused: `no_token`, `token_invalid` (sent but did not verify), `token_mismatch` (valid token for a different user, or no usable body `userId`).

### Internal trust (backend/lib/internalAuth.js)

Header `x-internal-auth: v1.<unix seconds>.<hex HMAC-SHA256(WORKER_SECRET, "v1.<unix seconds>.<userId>")>`.

- Constant-time compare. Valid for 5 minutes. Bound to the user id, so a captured header cannot be reused for another user.
- Fails closed: if `WORKER_SECRET` is unset or shorter than 16 characters, nothing validates and nothing is signed.
- Source IP, `X-Forwarded-For` and similar headers are never consulted, so the public internet cannot claim to be internal.
- It uses `WORKER_SECRET` (already required at boot) and not `TELEGRAM_WEBHOOK_SECRET`: the webhook secret is part of the webhook URL
  path and can end up in logs, and a leak of it must not let someone mint builds as any user.
- A bad internal header on a request that also carries a valid matching token does not block it (counted as `forgedInternalHeader`).

Callers:

- Telegram bot (in-process, loopback): `lib/telegram/pipeline.js` `createLoopbackBuilds().start` signs every generate call. Done.
  Note the Telegram routes are off unless `TELEGRAM_ROUTES_ENABLED=true`.
- Build worker callbacks use their own worker-secret routes and do not touch /generate. Unchanged.
- SMS/WhatsApp bot (`sms-bot/`, not deployed): NOT changed here. Before enforce can be turned on with that bot live it needs
  (1) `WORKER_SECRET` as a Fly secret of `vibebuild-sms-bot` (same value as `vibecoder-api`; do not print it), and
  (2) in `sms-bot/lib/backend.js` `startBuild`, add the header
  `'x-internal-auth': 'v1.' + ts + '.' + createHmac('sha256', WORKER_SECRET).update('v1.' + ts + '.' + userId).digest('hex')`
  with `ts = Math.floor(Date.now() / 1000)` (or import the same two lines as `signInternalAuth` in backend/lib/internalAuth.js).
  Until then, in enforce mode the SMS bot's builds get 401.

## Clients today (evidence from the code)

- Android: the generate call goes through `SseStreamReader.stream(... authToken = getAccessToken())`
  (`android/.../data/repository/ProjectRepository.kt:148-150`), which adds `Authorization: Bearer` when the token is non-null
  (`SseStreamReader.kt:77-79`). It sends `x-platform: android`. A signed-out or token-less session sends no header, and a stale
  token (expired, not refreshed) would count as `token_invalid`.
- Web: `streamSSE` (`web/src/lib/sse.ts:14`) uses `withAuth` (`web/src/lib/authHeader.ts`), which adds the Supabase session token
  when there is one. The web sends no `x-platform`; it is classified `web` from the browser User-Agent.
- Telegram bot: loopback, userId in body, no token (`backend/lib/telegram/pipeline.js`). Now signs.
- SMS/WhatsApp bot: `sms-bot/lib/backend.js:46`, body userId only, User-Agent `vibebuild-messaging/1.0` (classified `api`). Not live.
- Versions: before this change the app sent no version header, so versions were not distinguishable. This change adds
  `x-app-version: <versionName>` to the Android client (`AuthInterceptor.kt`, `SseStreamReader.kt`); it only shows up from the next
  Android release on. Older builds appear as version `none`. The web sends no version (it is always the latest deploy).

## Reading the counters

`GET https://vibecoder-api.fly.dev/api/generate-auth/stats` with header `x-worker-secret: <WORKER_SECRET>` (do not paste the secret in shared logs).

```
{ success, mode, scope, since, total, wouldBlock, forgedInternalHeader,
  totals:     { no_token, token_invalid, token_mismatch, token_match, internal_ok },
  byPlatform: { android: { ... }, web: { ... }, ios: { ... }, api: { ... } },
  byVersion:  { "2.7.3": { ... }, "none": { ... }, "other": { ... } },
  rows:       [ { outcome, platform, version, count } ] }
```

- `wouldBlock` = everything enforce mode would refuse (`no_token`, `token_invalid`, `token_mismatch`). Healthy end state: zero from `web` and from current Android versions; whatever remains is old app versions, the SMS bot before it signs, or abuse.
- Counters are in memory: per machine, reset on every restart or deploy, and `auto_stop_machines` is on. Query it more than once, and
  read `since`. Nothing is persisted to a database (the existing event tables are per-event, allow-listed rows; an aggregate would need a new table and migration, so it was skipped).
- Persistent record: a log line per outcome class at most once a minute, e.g.
  `[generate-auth] mode=report class=no_token would_block=true platform=android version=2.7.3 count_since_last_log=12`
  (`flyctl logs -a vibecoder-api | grep generate-auth`).
- No user ids, tokens or prompts are stored or logged. Platform and version are client-supplied labels (version is validated as digits and dots and capped at 40 distinct values, then `other`), so treat them as claims, useful for rollout decisions but not proof.
- `token_invalid` also counts a Supabase auth lookup failure (the shared helper returns null on errors). In enforce mode an auth outage therefore refuses builds (fail closed).

## Rollout plan

1. Deploy in report mode (the default; no secret change needed). Merge to main first, per the deploy rule.
2. Watch for at least 7 days, including a weekend, and until the current Android release has reached most of its users:
   check `/api/generate-auth/stats` daily and the log lines. Expect `token_match` for web and Android.
3. Look at `wouldBlock` by platform and version. Investigate `no_token`/`token_invalid` from `web` or current Android versions first
   (likely a client bug such as a token not refreshed on a long SSE start, or signed-out guest flows). Ship the fix, watch again.
4. Enforce only when unauthenticated, non-internal traffic from current app versions is about 0. Old versions that still send no
   token will break; decide that explicitly (a forced-update prompt first, if the numbers are not small). The SMS bot change above must be in
   place before that bot goes live.
5. Turn it on (owner runs this, not automated):
   `flyctl secrets set GENERATE_AUTH_MODE=enforce -a vibecoder-api`
   (restarts the machines; in-flight builds already dispatched to the worker are not affected, but in-flight SSE streams from the API drop on restart as with any deploy.)
6. Right after: watch the 401 rate (`class=... would_block=true` lines with `mode=enforce`) and support reports for 24 hours.

## Rollback

Instant and safe, no deploy needed: `flyctl secrets set GENERATE_AUTH_MODE=report -a vibecoder-api` (or `off`; or `flyctl secrets unset GENERATE_AUTH_MODE -a vibecoder-api`, which returns to the default `report`). All clients behave as before.

## Known limits

- Anonymous device ids (the old iOS flow had no login) have no token; enforce mode refuses them. iOS is no longer maintained; if any
  such traffic shows up as `ios`/`no_token`, decide before enforcing.
- Other body-userId routes (tweak, retry, fork and the rest) already use `lib/actAs.js`; `/progress?userId=` is a read of in-memory build progress and is out of scope here.
