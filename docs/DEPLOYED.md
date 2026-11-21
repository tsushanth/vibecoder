# Deployed releases (Play)

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

