# Chat channels: the Telegram bot

VibeBuild can be used from a chat. The Telegram bot (@Vibebuilder_bot) runs **inside the existing `vibecoder-api` Fly app**: no new app, no new machine, no new database. It is a thin client of the same build pipeline the Android and web apps use.

(The SMS / WhatsApp bot lives in `sms-bot/` and shares the account-link routes below. See `docs/telegram-routes-contract.md` for the request and response shapes it depends on.)

## How it works

```
Telegram  --POST-->  /api/telegram/webhook/:secret   (backend/routes/telegram.routes.js)
                         auth: path secret AND X-Telegram-Bot-Api-Secret-Token, constant-time; 200 at once, work afterwards
                              |
                         backend/lib/telegram/bot.js   dedupe -> language -> command / text
                              |  loopback (127.0.0.1) to the app's own endpoints, so every limit stays in one place:
                              |    POST /api/projects/generate   (source=telegram; prompt guard, secret capture, hourly + fair-use caps, worker dispatch)
                              |    GET  /api/projects/:id/progress  (the same payload the apps poll: building | ready | failed, phase, percent)
                              |    GET  /api/projects/suggestions?lang=  (idea buttons, translated and cached)
                              |  in-process
                              |    link codes (backend/lib/telegramLink.js), database, channel events
                         edits ONE status message with localized phase progress, then sends the preview link as a new message
```

Files: `backend/lib/telegram/{bot,api,format,metrics,pipeline,strings}.js`, `backend/lib/telegramLink.js`, `backend/routes/telegram.routes.js`, migration `backend/supabase/migrations/20261122000000_telegram_channel.sql`.

### What the bot does

| Message | Behaviour |
|---|---|
| `/start [payload]` | Greeting and how it works, three localized idea buttons. The first payload (`app`, `app_card`, `app_build`, `app_settings`, `web`, `web_home`, `web_connect`) is stored for install attribution. `/start link_ABC123` links the account. |
| any text | Treated as the app description: the bot confirms, queues a build, edits its status message through the phases (generate, validate, fix, polish, verify, package) with a progress bar, then sends the live preview link plus an "Open in VibeBuild" button. |
| `/apps` | The chat's last 5 projects (links for the ready ones). |
| `/language` | 27-button language picker; the choice is saved and wins over Telegram's `language_code`. |
| `/link` | Button to `vibebuild.cc/connect?tg_id=<id>&src=tg`: sign in, tap "Open Telegram to finish". Or send the 6-character code (alone, or `/link CODE`). Earlier anonymous builds from the chat move to the account. |
| `/stop` | Stops following the current build (the build itself cannot be cancelled and may still finish; see `/apps`). |
| `/help` | The command list. |

Private chats only. Non-text messages get a hint. Commands addressed to another bot (`/start@other_bot`) are ignored.

### Identity

* A linked chat builds as its VibeBuild account (`users.telegram_id`), so apps show up in the app and on the web.
* An unlinked chat builds as `tg_<telegram id>`, a `users` row with no email and no `telegram_id` (the `projects.creator_id` foreign key needs the row). Unlinked chats are capped lower (see Limits). After `/link` the earlier projects are re-owned by the account.

### Limits and abuse controls

* Everything the app is subject to still applies, because the bot calls the same endpoint: prompt guard (no code, no URLs), 2000 characters, per-user 30 builds/hour, the fair-use daily cap, and the worker's busy / quota 429s (shown as "at capacity").
* Bot-level, in memory per process (`DEFAULT_CONFIG` in `bot.js`): 20 messages/min/chat (one "slow down" notice per minute), 8 builds/hour/chat, **3 builds/day per unlinked chat**, **300 unlinked builds/day across all chats** (circuit breaker against throwaway Telegram accounts), 12 builds followed at once, one build per chat at a time.
* The "free until critical mass" policy (`VIBEBUILD_ALL_FREE`) is honoured automatically: the bot adds no paywall of its own.
* Webhook updates are de-duplicated by `update_id` (memory and the `telegram_updates` table). A deploy during a build does not lose the result: the followed build is stored on the chat row and resumed at startup.

### Security notes

* The webhook fails closed (503) unless `TELEGRAM_BOT_TOKEN` and a `TELEGRAM_WEBHOOK_SECRET` of 16+ characters are set and `TELEGRAM_ROUTES_ENABLED=true`. Wrong path secret or wrong header: 401.
* **Link codes are now only minted for the signed-in caller's own account** (`POST /api/telegram/link` and `GET /api/telegram/connect` need `Authorization: Bearer <token>` and the `userId` must be the token's user). Before, anyone who knew a user id (they are public in creator ids) could link their Telegram to that account. Now that the bot can list an account's projects this matters.
* Known and left alone because the SMS bot depends on it: `GET /api/telegram/user/:id` is unauthenticated (rate limited per address) and returns the account's user id and recent project titles for a chat id or phone number. Recommended follow-up: require `x-worker-secret` once `sms-bot` sends it.
* Events never store message text, names or prompts; chat ids are stored only as a keyed hash in `channel_events`.

## Translation status

Bot strings: `backend/lib/telegram/strings.js`, English plus the app's 26 languages (ar cs de el es fi fr hi hu id it ja ko ms nl pl pt ro ru sv th tl tr uk vi zh).

* The phase names, "working", "ready", "open live preview" and "at capacity" texts are **copied from the Android string resources** (`build_phase_*`, `build_chat_working`, `build_chat_ready_title`, `build_chat_open_live_preview`, `create_busy_body_free`).
* Every other string, and the new Android strings (`telegram_*`), are **machine-translated and need native-speaker review** before a market is promoted. Formality is not consistent across languages (informal in es, de, fr, it, cs; formal in nl, id, ms). Please review ar, hi, th, ja, ko, zh and tl first (highest chance of awkward phrasing).
* Idea buttons use the existing suggestion translator (`lib/suggestionI18n.js`), which already serves the app.

## Android, web, bot promotion

* Android: top banner (dismiss hides it 7 days, tapping the bot hides it for good), a card under the Create prompt box, a "Continue on Telegram" button on the build-complete card, a row in Account settings. All use `https://t.me/Vibebuilder_bot?start=<payload>`; payloads `app` (banner), `app_card`, `app_build`, `app_settings`.
* Web: "Build from Telegram" section on the home page (`start=web_home`), `/connect` (end to end, see below), `web/public/llms.txt`.
* Bot: a `/start` greeting, `/language`, and a link-account nudge when the unlinked daily cap is reached.
* `/connect` flow: bot `/link` -> `/connect?tg_id=<id>&src=tg` -> sign in (login honours a same-site `?redirect=`, also through Google sign-in) -> code created with the user's token -> "Open Telegram to finish" (`t.me/...?start=link_CODE`). The same page still serves the SMS bot's `?tg_id=<phone>` links (shows the code to text back).

## Owner steps to go live (nothing below has been done)

1. **Bot and token.** In Telegram, open @BotFather. If @Vibebuilder_bot is still yours: `/mybots` -> Vibebuilder_bot -> API Token -> Revoke current token (the old bot was removed in June, so treat the old token as burned). If it does not exist: `/newbot` and pick the name. Optionally `/setjoingroups` -> Disable. Save the token in Keychain at once.
2. **Webhook secret.** `openssl rand -hex 24` (48 hex characters; Telegram allows `A-Za-z0-9_-`).
3. **Database.** Run `backend/supabase/migrations/20261122000000_telegram_channel.sql` in the Supabase SQL editor (additive and idempotent; the project is shared with SimplyApply, only VibeBuild tables are touched). The code works before it is applied, but builds then lose source/metrics until it is.
4. **Merge the PR, then deploy** `backend/` (`flyctl deploy` from `backend/`) and `web/` (vibebuild-web). Check first: `flyctl secrets list -a vibecoder-api`.
5. **Fly secrets** (new, never overwrite an existing one):
   ```
   flyctl secrets set -a vibecoder-api TELEGRAM_BOT_TOKEN='<token>' TELEGRAM_WEBHOOK_SECRET='<hex>' TELEGRAM_ROUTES_ENABLED=true
   ```
   This restarts the app (in-flight builds are resumed by the bot, but do it when no calls/builds matter). `TELEGRAM_ROUTES_ENABLED=true` also re-enables `/api/telegram/user` and `/verify`, which fixes the SMS/WhatsApp bot's linking (it currently gets 503).
6. **Webhook** (run after the deploy is healthy):
   ```
   curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     --data-urlencode "url=https://vibecoder-api.fly.dev/api/telegram/webhook/${TELEGRAM_WEBHOOK_SECRET}" \
     --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
     --data-urlencode 'allowed_updates=["message","callback_query","my_chat_member"]' \
     --data-urlencode "drop_pending_updates=true"
   curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"   # url set, last_error_message empty
   ```
7. **Commands and descriptions in all languages:** `TELEGRAM_BOT_TOKEN=... node backend/scripts/telegram-setup-bot.mjs --apply` (dry run without `--apply`; the lists are in `docs/telegram-botfather-commands.md`).
8. **Live test:** `TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... bash backend/scripts/telegram-live-test.sh`, then the manual checklist it prints (about 10 minutes, one real build).
9. **Android:** the promotion needs a new release (not built or bumped here).

Rollback: set `TELEGRAM_ROUTES_ENABLED=false` (or `flyctl secrets unset TELEGRAM_BOT_TOKEN`), and `curl .../deleteWebhook`.

## Cost to run

No new infrastructure and no new vendor: the bot is a few hundred lines in the existing 512 MB `vibecoder-api` machine (min 1 running already), Telegram's Bot API is free, loopback calls cost no egress, a build costs what any app build costs (worker capacity and model usage). Spend is bounded by the caps above: at most 3 builds/day per unlinked chat and 300 unlinked builds/day in total, linked accounts follow the existing fair-use cap. Translating idea buttons reuses the cached suggestion translator (a few small model calls per language, once). Database: about 3 small writes per interaction.

## Known limits

* State is in memory per process (link codes, progress store, rate windows), exactly like the app's own. `vibecoder-api` runs one machine; with more than one, link codes and progress would break for the app too.
* "Open in VibeBuild" opens the project page on the web: the Android app has no verified app links yet, so it cannot open that URL itself.
* The app has no in-app "link Telegram" button; linking goes through the bot's `/link` and the web `/connect` page. `POST /api/telegram/link` (token required) is ready for one.
* `/stop` stops following a build; there is no worker-side cancel.
