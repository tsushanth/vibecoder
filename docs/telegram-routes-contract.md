# `/api/telegram/*` request and response shapes (contract)

`sms-bot/` (SMS and WhatsApp, Twilio) reuses these routes with a phone number in place of a Telegram id. **These shapes must stay backward compatible.** All routes answer `503 {"error":"disabled"}` unless `TELEGRAM_ROUTES_ENABLED=true`.

## `GET /api/telegram/user/:telegramId`

Look up the account linked to a chat id (a Telegram id, or a phone number for SMS/WhatsApp). Rate limited per address (60/min, then `429` with `Retry-After`).

```
200 { "linked": false }
200 { "linked": true, "userId": "...", "displayName": "...", "subscriptionTier": "free",
      "totalProjects": 0, "recentProjects": [ { id, title, status, created_at, published_url, preview_url } ] }
```

## `POST /api/telegram/verify`

Redeem a 6-character link code (single use, 10 minutes). Body: `{ "code": "ABC123", "telegramId": "<id or phone>", "telegramUsername": "optional", "telegramName": "optional" }`. Codes are case-insensitive.

```
200 { "success": true, "userId": "...", "displayName": "...", "subscriptionTier": "free" }
400 { "error": "code and telegramId are required" }
404 { "error": "Invalid or expired code" }
410 { "error": "Code has expired" }
429 { "error": "Too many attempts, try again later" }   (+ Retry-After; failures are limited per address and globally)
```

Side effect: `users.telegram_id` / `telegram_username` are set on the account, and (new) removed from any other account that held the same id.

## Minting codes (changed: now requires sign-in)

`POST /api/telegram/link` body `{ "userId": "..." }` and `GET /api/telegram/connect?tg_id=...&user_id=...` now require `Authorization: Bearer <Supabase access token>` and the user id must be the token's user (`401` without a verified token, `403` for another user's id). Response shapes are unchanged:

```
POST /link    200 { "success": true, "code": "ABC123", "botUrl": "https://t.me/Vibebuilder_bot?start=link_ABC123", "expiresIn": 600 }
GET  /connect 200 { "success": true, "code": "ABC123", "expiresIn": 600 }
429 per user (5 / 10 min) and per address (20 / 10 min); 503 {"error":"busy"} when too many codes are outstanding
```

`sms-bot` does not call these two (the person gets the code on the web `/connect` page), so it is unaffected.

## New

* `POST /api/telegram/webhook/:secret`: Telegram updates (see docs/channels.md).
* `GET /api/telegram/stats?days=7`: channel funnel numbers (header `x-worker-secret`).
* `POST /api/telegram/notify` is unchanged (worker secret, sends a Markdown message to a linked Telegram chat).

## Source channel for builds

`POST /api/projects/generate` now records `projects.source_channel`. Bots should send `"source": "sms"` / `"whatsapp"` / `"telegram"` in the JSON body (sms-bot already sends `sms`; the value `whatsapp` is accepted too).
