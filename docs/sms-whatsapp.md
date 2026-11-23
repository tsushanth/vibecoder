# VibeBuild by text: SMS and WhatsApp

Status on 2026-11-22: code rebuilt and tested, NOT deployed, NOT live. The Fly app `vibebuild-sms-bot` is stopped and Twilio is not
registered for either channel, so nothing can be sent or received until the owner steps at the end are done.
Code: `sms-bot/`. Branch/PR: `feat/sms-whatsapp-channel-2026-11-22`.

## Twilio facts (read-only inspection, account AC5271b7..., 2026-11-22)

| Item | Finding |
|---|---|
| Balance | USD 15.64 |
| Numbers owned | 74 (mostly CallDesk voice pools). The ones that matter here are below. |
| +1 775 278 8677 (local, the number the old /sms page advertised) | SMS webhook `https://vibebuild-sms-bot-917362189743.us-central1.run.app/sms/inbound` (an old Cloud Run host, not Fly). Voice webhook points at the CallDesk telephony service. NOT attached to any messaging service, so no A2P campaign covers it. |
| +1 855 918 6924 (toll-free, named "VibeBuild SMS Bot") | SMS webhook `http://178.156.231.255:3459/sms` (an old Hetzner box, plain http, dead). No toll-free verification exists for it. Attached to messaging service "VibeBuild WhatsApp" (no campaign). |
| A2P 10DLC brand | Brand `BN4f84cecb...` STANDARD, APPROVED, identity VERIFIED (Kreative Koala LLC). Fine. |
| A2P campaign | Messaging service "Low Volume Mixed A2P Messaging Service": campaign status FAILED, error 30909 "Message flow doesn't show how people sign up for your texts". Only +1 270 818 7836 is in that service. Opt-in keyword START; opt-out STOP/CANCEL/END/QUIT/UNSUBSCRIBE/REVOKE/OPTOUT/STOPALL; HELP/INFO. |
| Toll-free verification | The only record on the account is for +1 855 915 2245 (a different number): TWILIO_REJECTED, "Business Email Address Must Use an Official Domain". |
| WhatsApp | Only the Twilio sandbox sender `whatsapp:+14155238886`, status OFFLINE, webhook `http://178.156.231.255:3463/whatsapp` (dead). No production WhatsApp sender, no WABA id. Messaging service "VibeBuild WhatsApp" also points at that dead host. |
| VibeBuild usage, all time | 775: 2 inbound (2026-04-12), 4 outbound, all undelivered with error 30034 (US long code not registered for A2P). 855-6924: 3 inbound (2026-03-31/04-01), 243 outbound, all undelivered with error 30032 (toll-free not verified), to one recipient. WhatsApp sandbox: 9 inbound and 17 outbound, all 2026-04-01 (3 failed 63019/63007). |
| VibeBuild usage, last 90 days | 775: 0 inbound, 0 outbound. WhatsApp: 0. 855-6924: 0 inbound, 66 outbound, all undelivered 30032, last on 2026-11-16, one recipient. Something still sends from that number (about USD 0.017 per attempt); find and stop it. Real VibeBuild inbound users in 90 days: 0. |
| Account-wide 90 days (mostly CallDesk) | sms-inbound 150 messages, sms-outbound 130 (USD 1.87), carrier fees USD 0.79. |

Conclusion: today a US text to +1 775 278 8677 reaches no working handler, and even a working handler could not answer it
(30034). A US-deliverable SMS channel needs either an approved 10DLC campaign (775) or a verified toll-free number.

## How it works

```
user texts the number  ->  Twilio  ->  POST https://vibebuild-sms-bot.fly.dev/sms/inbound  (or /whatsapp/inbound)
   X-Twilio-Signature checked (fail closed) -> dedupe MessageSid -> rate limits -> bot
   bot replies in the TwiML response (escaped), builds in the background:
   POST {API}/api/projects/generate (stream:false) -> project id -> poll GET {API}/api/projects/:id/progress
   -> text "Build complete" + https://vibebuild.cc/project/<id> through the Twilio REST API.
```

- Inbound only. We answer people who texted first. There is no cold outbound and no marketing; the only unprompted texts are the
  finished/failed build result and at most one "still working" note after 90 s, and only to numbers that texted in and have not opted out.
- Account link: the person is asked to open `https://vibebuild.cc/connect?tg_id=<phone>`, sign in and text back the 6-character code.
  The bot calls `POST /api/telegram/verify` and `GET /api/telegram/user/:phone` (the phone number is the id). Their first prompt is kept
  for one hour and built right after linking. SMS and WhatsApp share one account link.
- Commands: STOP and its synonyms, START/UNSTOP, HELP/INFO, STATUS, `LANG xx`. Opt-outs are stored per channel (an SMS STOP does not block WhatsApp).
  On SMS no reply is sent to STOP (Twilio's own opt-out handling confirms it); on WhatsApp the bot confirms.
- Limits: 8 messages per minute per number (STOP is always honoured), 5 builds per number per UTC day, 8 builds at once, 300 inbound per
  minute overall, one build per number at a time, prompts with URLs refused, SMS replies only to +1 numbers by default (`SMS_ALLOWED_PREFIXES`).
- State: one JSON file on a Fly volume at `/data/state.json` (language per number, opt-outs, last-inbound times, MessageSid ring, builds in
  flight; written atomically). Chosen because the repo has no per-user store reachable from this service (the backend routes are Telegram-only,
  and `backend/` is out of scope), a volume costs about USD 0.15/month, and it needs no new dependency. Builds in flight are resumed after a restart.
  If the volume is missing the bot runs in memory and `/health` says `persistent:false`. A volume pins the app to ONE machine.
- Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (sender for SMS), `TWILIO_WHATSAPP_NUMBER` (WhatsApp is off when empty),
  optional `TWILIO_MESSAGING_SERVICE_SID`, `WHATSAPP_TEMPLATE_DONE_SID`, `STATS_TOKEN` (enables `GET /stats` counters), plus the fly.toml values.
  `PUBLIC_BASE_URL` must equal the host Twilio is configured with: the signature covers the full URL.
- A bug fixed on the way: the old bot called `res.json()` on `/api/projects/generate`, which now answers with a one-event SSE stream when
  `stream:false`, so every SMS build would have been reported as failed even when it worked.

## Languages (27 locales of the app)

en, ar, cs, de, el, es, fi, fr, hi, hu, id, it, ja, ko, ms, nl, pl, pt-BR, ro, ru, sv, th, tl, tr, uk, vi, zh-CN.

- Detected from the first prompt: script (kana, hangul, Han, Thai, Devanagari, Arabic, Greek, Cyrillic with uk vs ru letters) or stopwords plus
  distinctive letters for Latin scripts. Persisted per number. If unsure it answers in English and adds one line explaining `LANG es`. `LANG xx` always wins.
- Phase names, "Build complete", "build failed", "app may still be building", busy and limit messages come from the Android `strings.xml`
  (regenerate with `node sms-bot/scripts/extract-app-strings.mjs`). The other 18 bot strings (link, ack, help, opt-out, ...) are machine-translated
  and NEED NATIVE REVIEW before wide promotion, especially the HELP text. STOP, START, HELP, STATUS and LANG stay English (carriers parse them).
- SMS segment cost (final "build complete" text with a 36-character project link; computed by the tests):
  - 1 segment, GSM-7: en, de, fi, fr, id, it, ms, nl, sv, tl.
  - 2 segments: ar, cs, el, es, hi, hu, ja, ko, pl, pt-BR, ro, ru, th, tr, uk, vi, zh-CN. Non-Latin scripts and any accent outside GSM-7 (a, i, o, u with acute, and others) make the whole message UCS-2 (70 characters per segment, 67 when split), so the same text costs about double.
  - Texts are kept short for this reason: the acknowledgement is 1 segment in every language except el and fr (2). The HELP text is 1-3 segments.
  - Emoji and smart punctuation are not used on SMS (one emoji would turn a 1-segment English text into UCS-2). WhatsApp gets a leading check mark on the result.

## Cost

Per-message prices from Twilio's public page ("current as of November 2026"): US SMS USD 0.0083 per segment each way (local and toll-free), plus carrier fees
about 0.0035-0.005 per outbound segment (AT&T 0.0035, T-Mobile 0.0045, Verizon 0.005, others 0.0042) and 0.0025-0.0035 inbound; failed messages cost 0.001. The account's own
90-day records agree (0.0083 per segment, carrier fees about 0.0043 per segment).

| Conversation | SMS (US) | WhatsApp |
|---|---|---|
| Linked user, English: 1 prompt in, ack + result out | about USD 0.036 (1 in 0.011, 2 out 0.025) | about USD 0.015 Twilio fee (3 messages x 0.005) plus Meta fees, see below |
| First time: prompt, link text, code, linked text, result | about USD 0.06 | about USD 0.025 |
| Same, 2-segment result (UCS-2 languages) | add about 0.0125 | no change |
| Slow build (one extra status text) | add about 0.0125 | add 0.005 |

WhatsApp Meta fees: Twilio charges USD 0.005 per message in or out. Meta's own fee for replies inside the 24 h window after the user's message is where I found
conflicting information: Twilio's pricing page says no charge, secondary sources say service messages are charged from 2026-10-01 after 1,000 free per month per number.
Utility templates are listed at about 0.0034 (US). I did not verify Meta's rate card; check it before promoting. With 5 builds per number per day the worst case per number is about USD 0.30/day on SMS.

Fixed monthly: Fly machine 256 MB shared CPU about USD 2 and volume about USD 0.15 (from Fly's public pricing, approximate, not re-checked), plus the Twilio number rental already paid
(775 and 855-6924 are owned). A2P campaign: Twilio quotes a one-time vetting fee of USD 15 and a monthly campaign fee that is lower for Low Volume Mixed; I could not find the exact
monthly amount, check the Console. Total at tiny volume: roughly USD 2-5 per month.

## Compliance facts (not legal conclusions)

Verified from the code:
- We only message numbers that texted us first. Result texts go only to a number that has not sent STOP on that channel (checked again when the build finishes).
- STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT/REVOKE/OPTOUT are recorded per channel. START/UNSTOP/YES re-subscribes. HELP/INFO returns the brand, how to stop, "Msg&data rates may apply" and support@vibebuild.cc, in the user's language.
- Phone numbers and the chosen language are stored in `/data/state.json` (personal data). A prompt sent before linking is held up to one hour and removed after the build is accepted, on link, or on STOP. Prompt text is not logged; logs show masked numbers.
- Webhooks reject unsigned or wrongly signed requests with 403 and answer 503 if no auth token is configured.

Facts from Twilio's account and docs that the owner must act on:
- The failed campaign must be resubmitted with a message flow that describes how a person opts in (texting the number first, or after reading a public page) and links to the page they see. The registered sample messages
  and the `has_embedded_links: false` setting do not match the new texts (which include links and no emoji); update them to the real texts below.
- US SMS needs either an approved campaign on the sending number (error 30034 when missing) or a verified toll-free number (error 30032 when missing).
- WhatsApp needs a Meta-approved business sender; free-form messages are only allowed within 24 h of the user's last message, otherwise only an approved template.
  The bot checks this and, outside the window, sends only `WHATSAPP_TEMPLATE_DONE_SID` if set, otherwise skips and counts it (`wa_outside_window_skipped`).
  Builds take 1-3 minutes, so v1 does not need any template. Templates to submit to Meta only if out-of-window notifications are wanted later: a UTILITY template `build_ready` ("Your app is ready: {{1}}") in each language you promote.
- The privacy page and `/sms` page should describe SMS/WhatsApp use (they currently say the feature is off); that is in `web/`, owned by the other branch.

Backend dependencies seen on the live API (owned by the other branch, which keeps these shapes compatible):
- `GET /api/telegram/user/:id` and `POST /api/telegram/verify` answer 503 "disabled" today (checked 2026-11-22), so linking fails until `TELEGRAM_ROUTES_ENABLED=true`. The bot then says "try again in a minute".
- `/api/telegram/user/:id` is unauthenticated and returns the display name and recent projects for any phone number (account enumeration by phone); link codes are not bound to the phone; `/api/projects/generate` trusts `userId` from the body.
- SMS builds are stored with `creation_method: 'ai_generated'` (only `source: 'telegram'` is special-cased), and usage events label them source `api`, so they cannot be counted separately yet. The bot sends `source: 'sms'` or `'whatsapp'`, so counting only needs a backend change.
- `magicLinks` are in backend memory (one machine today): a backend restart within 10 minutes of a code being issued invalidates it.

## Owner steps to go live

Order matters; steps 2-3 are the slow, externally gated ones, start them first.

1. Merge the PR to main (this document and `sms-bot/`). Ask the Telegram/link branch to deploy with `TELEGRAM_ROUTES_ENABLED=true` (needed for linking).
2. Choose the SMS number and register it (pick one, or both in parallel):
   - Toll-free `+18559186924`: Console, Messaging, Regulatory Compliance, Toll-free verification. Use an email on the official company domain (the previous rejection was "Business Email Address Must Use an Official Domain"), opt-in = person texts first, link to the public page. Twilio's documented target is about 3 business days.
   - Local `+17752788677`: resubmit the failed campaign (Messaging, Regulatory Compliance, A2P 10DLC): use case Low Volume Mixed or Low Volume, message flow naming the exact opt-in and linking the public page, samples equal to the real texts, embedded links = yes. Add the number to the service's sender pool. Twilio quotes up to 5 business days in one place and 10-15 days in another.
3. WhatsApp (optional, the international channel): Console, Messaging, Senders, WhatsApp senders, register a sender (Meta Business Manager and business verification, display name approval). Use a number that is not used by the WhatsApp app and can receive the registration code; do not use the CallDesk numbers. Duration depends on Meta verification (commonly days to weeks, not verified here).
4. Fly (from `sms-bot/` on main): `flyctl machines list -a vibebuild-sms-bot`, destroy all but one machine; `flyctl volumes create sms_data --region iad --size 1 -a vibebuild-sms-bot`; `flyctl deploy -a vibebuild-sms-bot`; confirm `curl https://vibebuild-sms-bot.fly.dev/health` shows `"persistent":true`. If Fly says the app is suspended, `flyctl apps resume vibebuild-sms-bot` first. Secrets `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_NUMBER` already exist by name: check that `TWILIO_PHONE_NUMBER` is the number you registered in step 2 and set `TWILIO_WHATSAPP_NUMBER` to the real sender once step 3 is approved (empty keeps WhatsApp off). Optional: `flyctl secrets set STATS_TOKEN=<random>`.
5. Twilio webhooks (after approval): set the registered number's "A message comes in" to `https://vibebuild-sms-bot.fly.dev/sms/inbound` (HTTP POST); set the WhatsApp sender's webhook to `https://vibebuild-sms-bot.fly.dev/whatsapp/inbound`. Remove the dead webhooks: the Cloud Run and Hetzner URLs listed above, the messaging service "VibeBuild WhatsApp", the sandbox sender.
6. Find and stop whatever still sends from `+18559186924` (66 failed texts in the last 90 days, newest 2026-11-16).
7. Smoke test from your own phone: text "HELP", then a prompt, link your account with the code, confirm the result text, then STOP and START. Check `GET /stats` and Twilio's message logs (status callbacks count delivery errors by code).
8. Only then promote: have native speakers review the machine-translated strings first, and ask the web branch to update `/sms`, `/connect`, the privacy page and the app screens with the real number.

## Tests

`cd sms-bot && npm ci && node --test --test-concurrency=2 --test-force-exit` (29 tests, no network: fake Twilio client, fake API, local HTTP server).
They cover signature validation, STOP/START, dedupe, rate limits, language detection for all 27 locales, string completeness, segment costs, link flow, happy path,
failure paths, WhatsApp 24 h window, restart persistence and the API client.
Not covered: a real Twilio delivery, the real backend (its routes are disabled), a real Fly deploy.
