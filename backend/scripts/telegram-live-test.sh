#!/usr/bin/env bash
# Live check of the Telegram bot after the owner steps in docs/channels.md. Needs TELEGRAM_BOT_TOKEN (and TELEGRAM_WEBHOOK_SECRET for the
# webhook auth probes) in the environment. Never prints the token or the secret. Sends no message to anyone.
set -u
API_HOST="${API_HOST:-https://vibecoder-api.fly.dev}"
pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }

[ -n "${TELEGRAM_BOT_TOKEN:-}" ] || { echo "TELEGRAM_BOT_TOKEN is not set"; exit 2; }

# 1. the token is valid and is the right bot
me=$(curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe")
echo "$me" | grep -q '"ok":true' && ok "getMe" || bad "getMe (token revoked or wrong)"
echo "$me" | grep -qi '"username":"Vibebuilder_bot"' && ok "bot username is Vibebuilder_bot" || bad "bot username is not Vibebuilder_bot"

# 2. the API is up and the webhook route is live (503 = not configured, 401 = configured and closed)
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "${API_HOST}/api/telegram/webhook/wrong-secret")
[ "$code" = "401" ] && ok "webhook rejects a wrong secret (401)" || bad "webhook with a wrong secret answered $code (expected 401; 503 means the secrets or TELEGRAM_ROUTES_ENABLED are not set)"
if [ -n "${TELEGRAM_WEBHOOK_SECRET:-}" ]; then
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "${API_HOST}/api/telegram/webhook/${TELEGRAM_WEBHOOK_SECRET}")
  [ "$code" = "401" ] && ok "webhook rejects a right path with no header (401)" || bad "right path, no header answered $code (expected 401)"
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H "X-Telegram-Bot-Api-Secret-Token: ${TELEGRAM_WEBHOOK_SECRET}" -d '{"update_id":1}' "${API_HOST}/api/telegram/webhook/${TELEGRAM_WEBHOOK_SECRET}")
  [ "$code" = "200" ] && ok "webhook accepts a correctly authenticated update (200; an empty update is ignored)" || bad "authenticated probe answered $code (expected 200)"
fi

# 3. Telegram's view of the webhook
info=$(curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo")
echo "$info" | grep -q "${API_HOST#https://}/api/telegram/webhook/" && ok "webhook url points at ${API_HOST#https://}" || bad "webhook url is not set to ${API_HOST} (run setWebhook, docs/channels.md step 6)"
echo "$info" | grep -q '"last_error_message"' && bad "Telegram reports a delivery error: $(echo "$info" | sed -E 's/.*"last_error_message":"([^"]*)".*/\1/')" || ok "no delivery errors reported by Telegram"

echo
echo "$pass passed, $fail failed"
cat <<'MANUAL'

Manual checklist (about 10 minutes, one real build; use your own Telegram account):
  1. Open https://t.me/Vibebuilder_bot?start=app  -> greeting in your language + 3 idea buttons.        (records start_payload=app)
  2. Tap an idea  -> "On it" message, then the status message edits through Generate ... Package.
  3. After about 2 minutes: "Your app is ready" message with "Open live preview" and "Open in VibeBuild" buttons; the preview opens.
  4. /language -> pick Deutsch -> send /help: German. Switch back.
  5. /apps -> the app is listed.   6. Send two descriptions quickly -> the second is told a build is running.
  7. /link -> button -> sign in on vibebuild.cc -> "Open Telegram to finish" -> "Connected!". /apps still lists the app.
  8. Same app is in the Android app (My Apps) when signed in with the same account.
  9. curl -s -H "x-worker-secret: $WORKER_SECRET" "$API_HOST/api/telegram/stats?days=1"  -> events and your start payload.
 10. Android build with this release: Create tab shows the Telegram card; the banner opens the bot with ?start=app.
MANUAL
[ "$fail" -eq 0 ]
