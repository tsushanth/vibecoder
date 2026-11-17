# Deployed releases (Play)

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
- API (Fly app `vibecoder-api`, not Cloud Run): release v62 from origin/main a3336e2 (PRs #106 API side, #110, #115), image N/A. `npm test` 750/750 passed. Health: /api/health ok, /api/health/deep ready (direct mode), unauthenticated DELETE /api/auth/account returns 401. Account deletion end to end was covered by the integration tests (no real or test user was deleted).
- API rollback: `flyctl releases rollback 61 -a vibecoder-api` (v61 image deployment-01M7349QX0VYSSG5EMSBB12C5P).

