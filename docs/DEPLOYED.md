# Deployed releases (Play)

## Telegram channel LIVE 2026-11-22 (PR #135, main f32e611): backend v67, web v35, Android 2.7.2 (78) at 20%
- Database: `backend/supabase/migrations/20261122000000_telegram_channel.sql` applied to the Replitor Supabase project (owvvrljdfnhntwedepkl) through the Supabase management API with the owner's CLI login, as one multi-statement request. Verified: tables telegram_chats, telegram_updates, channel_events (row level security on, no anon/authenticated grants) and column projects.source_channel exist. Rollback SQL is in the migration header.
- Backend: Fly `vibecoder-api` release v67 from origin/main f32e611 (backend tree aee43e22 identical to main), image deployment-01M83D3XM7T52QR5MA7K2046QZ. `npm test` 813/813 on the PR branch before merge. New Fly secrets (names only): TELEGRAM_BOT_TOKEN (token of @Vibebuilder_bot, kept in Keychain item vibebuild-telegram-bot-token), TELEGRAM_WEBHOOK_SECRET (Keychain item vibebuild-telegram-webhook-secret), TELEGRAM_ROUTES_ENABLED=true. Rollback: `flyctl releases rollback 66 -a vibecoder-api` and unset TELEGRAM_ROUTES_ENABLED.
- Webhook: setWebhook to /api/telegram/webhook/<secret> with the same value as secret_token, allowed_updates message+callback_query; getWebhookInfo: no error, 0 pending. Bot commands, descriptions and short descriptions set for 26 languages (backend/scripts/telegram-setup-bot.mjs --apply).
- Live test on the owner's Pixel (Telegram, real bot): /start app -> localized greeting with 3 idea buttons; tapping one built an app in about 50 s with a progress message (Generate/Validate/Fix/Polish/Verify) and a final 'Your app is ready' message with 'Open live preview' and 'Open in VibeBuild' buttons; /language listed 26 languages and switching to Japanese gave Japanese confirmation and /help (chat set back to English). channel_events rows were recorded (update_received, start, idea_picked, build_queued, build_finished, language_changed, help). Not tested: linking an account with /link, an unlinked-chat daily cap, groups, the Open in VibeBuild landing.
- Web: Fly `vibebuild-web` release v35 from origin/main (web tree 4d154047 identical to main), image deployment-01M83DJ78RW3XVXXJCSFGR4ZPN. Home page has 'Build from Telegram' (link t.me/Vibebuilder_bot?start=web_home); /connect, /login 200; /llms.txt now 200 (it was 404).
- Android 2.7.2 (versionCode 78): built from origin/main 7cd64d0 (android tree 71397a9f identical to main), upload-key signature, AAB sha256 9c519ec618e8579f0f459dc02df7b93ebc68524e314983f7bace178ddf8f47e9. Tests run on the release tree: TelegramBannerPolicyTest, LocaleResourceParityTest, NoHardcodedUiStringsTest pass. Play production read back: 2.7.2 (78) inProgress userFraction 0.2; 2.7.1 (77) completed. Contents: Telegram banner that re-shows after 7 days until the bot is opened, Create-screen card, post-build 'Continue on Telegram', Account row, all localized. Not device-tested.
- SMS/WhatsApp bot (PR #134, main b2c248b) is merged but NOT deployed and cannot work yet: no A2P 10DLC campaign (failed 30909) and no toll-free verification covers a number, no production WhatsApp sender; see docs/sms-whatsapp.md.
- Security: POST /api/telegram/link and GET /api/telegram/connect now require the signed-in caller's own token. Still open: POST /api/projects/generate trusts the userId in the body.
- Rollback (Android): halt the rollout in Play Console (2.7.1 (77) stays completed), or re-upload 2.7.1 content as a new versionCode.

## 2.7.1 (versionCode 77): production, 100% since 2026-11-22 (20% staged rollout earlier the same day)
- Built from origin/main da1f860 (tag `play/2.7.1-77`), clean tree; the built `android/` tree equals `origin/main`. Signed with the upload key. AAB sha256: 8479311603ec3b2e95f3dcc9c2505bd40e1f766bd946ff280bde7bf8bac7b286
- Play production track read back after commit: 2.7.1 (77) inProgress userFraction 0.2; 2.7.0 (76) completed.
- Contents: #124 (remaining hard-coded English moved to strings.xml, merged earlier but not in 2.7.0) and #129 (build progress text shown in the app language instead of the worker's English; ServerProgressText). Triggered by a 1-star review "Not in Chinese" (zh-CN, 2.7.0, 2026-11-21): the build screen printed the worker's English progress lines.
- Tests: ServerProgressTextTest, parity, hard-coded-string and language tests passed on the #129 branch (run by the investigating agent, not re-run on the release tree). No device test. Not fixed: the language of the generated app itself (the deployed worker has no language instruction); zh strings still need native review.
- Raised to 100% on 2026-11-22 on the owner's instruction ("vibebuild is not that many people"), a few hours after the 20% start (Play Developer API edit: 2.7.1 (77) set to completed with no userFraction, validated, committed). Play production track read back afterwards: 2.7.1 (77) completed, no other release listed. No device test was possible: the Pixel's 2.7.0 is the Play-signed copy and an upload-signed build cannot install over it. The reviewer was answered on Play the same day.
- Rollback: a completed release cannot be halted; re-upload 2.7.0 content as a new versionCode.

## Backend (2026-11-22, no half-translated idea chips)
- Fly app `vibecoder-api`: release v66 from origin/main b3c5f45 (PR #129), image deployment-01M821TRH47E55ZA43VDVGXXDW. `npm test` 780/780 (node --test, concurrency 2). /api/health healthy; GET /api/projects/suggestions?lang=zh|ja|th&count=6 returns 6 fully translated items each (label and prompt).
- A translated label with the prompt left in English is now retried once, and if it stays English the whole item stays English (it used to build an English app from a Chinese chip).
- Rollback: `flyctl releases rollback 65 -a vibecoder-api`.

## 2026-11-21 Web (vibebuild.cc, Fly `vibebuild-web`): admin section with Gaugemint website visits (#127)
- Release v34, built from `origin/main` at `34806a4` (squash merge of #127; `web/` tree `c5cdfc0a6b6957aa53ffbbd2487c812ae9e5e8b6` identical to main), image `registry.fly.io/vibebuild-web:deployment-01M80NEB223JKMYT3AWWT9C8KY` (sha256:4121918c2d14...), `flyctl deploy --remote-only` from `web/` of a clean detached worktree. Adds a "Website visits (Gaugemint)" section to /admin: server-side read-only key, new Fly secret `GAUGEMINT_READ_KEY` (copy in Keychain `GAUGEMINT_READ_KEY_vibebuild.cc`), admin-gated route `/api/admin/gaugemint` separate from the overview route.
- Verified live: home 200, `/api/admin/gaugemint` 404 for anonymous callers. NOT verified: the section rendering for the admin account (needs a login); check once and note it here.
- Tests before merge: 196 pass, 0 fail, `tsc` clean. `next build` passed once locally and failed once on a Google Fonts fetch (network); the Fly remote build succeeded.

## 2026-11-21 Web (vibebuild.cc, Fly `vibebuild-web`): Gaugemint visit counter on public marketing pages (#125)
- Release v33 (previous v32, 2026-11-10), built from `origin/main` at `bba9478` (squash merge of #125) with `flyctl deploy --remote-only` from `web/` of a clean detached worktree. The previous image had no commit label, so the web tree it was built from is inferred (the live `/privacy` still had the pre-#106 text): this deploy therefore also shipped #106's `privacy/page.tsx` and `delete-account/page.tsx` copy (account deletion and AI providers; its backend and worker parts were live since 2026-11-17). The only other `web/` change in the range was none.
- Verified live in a real browser: the home page injects `<script data-domain="vibebuild.cc" src="https://guagemint.com/js/script.js">` (absent from server HTML by design: next/script afterInteractive); `/login` and `/signup` load none; the privacy page carries the new sentence about Gaugemint (own visit counter, no cookies, no IP stored). Checked before merge: 12 app and auth routes do not load it. The site is registered in the Gaugemint ops account. The script honours Do Not Track and Global Privacy Control.

## 2.7.0 (versionCode 76): production, 20% staged rollout, 2026-11-17
- Built from origin/main c5c5ace (tag `play/2.7.0-76`), clean tree. AAB sha256: 59c071bf2314daacc8a4639b923a3471197374be454cdab0417db7887572f8cb
- Play production track read back after commit: 2.7.0 (76) inProgress userFraction 0.2; 2.6.0 (75) completed.
- Contents: PR #119 (Create-screen idea chips and templates in the app language, ~67 strings moved out of Kotlin, all 26 languages, machine translated, needs native review) and #120 (version bump). Backend side (#117, #118) is deployed, see below.
- Not covered: error text built inside view models (CreateViewModel, SubscriptionViewModel, ProjectPreviewViewModel), server-sent messages, notification channel name, sample projects in BrowseViewModel. No device test was run.
- Rollback: halt the rollout in Play Console (2.6.0 (75) stays completed for everyone else); to withdraw it, re-upload 2.6.0 content as a new versionCode, since a versionCode cannot be reused.

## Backend (2026-11-17, idea suggestions in the app language)
- Fly app `vibecoder-api`: release v64 from origin/main 48089cd (PRs #117 and #118), image deployment-01M7NWTRS7CBMFG1DRAX1DRQXG (v63 = #117 alone, deployment-01M7NWQ0QTS2H9GGXSN0SQ7FXR). `npm test` 765/765. /api/health healthy; GET /api/projects/suggestions?lang=de|ja|es|hi|ar|zh returns translated items, no lang returns English as before.
- Rollback: `flyctl releases rollback 62 -a vibecoder-api` (v62 image from the earlier entry below). Old app versions send no lang and are unaffected either way.

## Backend (2026-11-17, malformed model output in idea-chip translation)
- Fly app `vibecoder-api`: release v65 from origin/main 4e8571a (PR #122), image deployment-01M7PCWF6PRH01E5C1AQG7V29E. `npm test` 778/778. /api/health healthy; GET /api/projects/suggestions?lang=th|de|ja&count=6 returns translated items (Thai 10/10 translated at count=10).
- Fixes the Thai/German batches that logged `Expected ',' or '}' after property value in JSON`: delimiter-format prompt, tolerant parser (fences, unescaped quotes, truncation), one retry for missing items, per-item English fallback. /suggest-ideas uses the same parser.
- Rollback: `flyctl releases rollback 64 -a vibecoder-api`.

## 2.6.0 (versionCode 75): production, 20% staged rollout, 2026-11-16
- Release commit (built from): 27ddee9 (tag `play/2.6.0-75`). origin/main at upload time had one later commit that only touches Play listing metadata (1410825); the Android app paths are identical (git diff 27ddee9 origin/main -- android/app is empty).
- AAB sha256: 8496f01a9767d599d2468275d59f2815803fb3a1eeb38af24cefc9916c9b8b8f
- Play production track read back after commit: 2.6.0 (75) inProgress userFraction 0.2; 2.5.6 (74) completed.
- Contents: PR #111 (26 languages, in-app language picker lists every shipped language, build chat/sign-in errors/tabs/dialogs localized) and #112 (version bump). Translations are machine-made and need native review. The worker prompt change was reverted before merge and the Hetzner worker was not touched.
- Rollback: re-upload 2.5.6 (74) as the completed production release with the same API pattern, or halt the rollout.

## Backend (2026-11-17)

Order: worker first, then API (account deletion needs both).

- Worker (Hetzner vibebuild-worker, 178.156.231.255, pm2 `vibecoder-worker` under the vibecoder user): added the PR #106 `DELETE /repo/:repoName` route by a minimal patch, because the deployed `server.js` has drifted from `worker/server.js` and must not be overwritten. Changes: new file `lib/githubRepo.js` (copied from origin/main a3336e2), one import line and the route block in `server.js`. Backup of the previous file: `/home/vibecoder/worker/server.js.bak.before-106.1794956923`. Checked with `node --check`, restarted only when /health showed activeGenerations 0 and no open connections. Verified: no or wrong secret gives 401, a non-app repo name gives 400, a valid-format name that does not exist gives 200 `alreadyGone`.
- Worker rollback: `ssh box231 'cd /home/vibecoder/worker && cp -p server.js.bak.before-106.1794956923 server.js && rm lib/githubRepo.js && su vibecoder -c "pm2 restart vibecoder-worker"'` (check /health is idle first).
- API (Fly app `vibecoder-api`, not Cloud Run): release v62 from origin/main a3336e2 (PRs #106 API side, #110, #115), image deployment-01M7NWBDZVZ8P7WRSF86JB3FJT. `npm test` 750/750 passed. Health: /api/health ok, /api/health/deep ready (direct mode), unauthenticated DELETE /api/auth/account returns 401. Account deletion end to end was covered by the integration tests (no real or test user was deleted).
- API rollback: `flyctl releases rollback 61 -a vibecoder-api` (v61 image deployment-01M7349QX0VYSSG5EMSBB12C5P).

