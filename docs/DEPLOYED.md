# Deployed releases (Play)

## 2.6.0 (versionCode 75): production, 20% staged rollout, 2026-11-16
- Release commit (built from): 27ddee9 (tag `play/2.6.0-75`). origin/main at upload time had one later commit that only touches Play listing metadata (1410825); the Android app paths are identical (git diff 27ddee9 origin/main -- android/app is empty).
- AAB sha256: 8496f01a9767d599d2468275d59f2815803fb3a1eeb38af24cefc9916c9b8b8f
- Play production track read back after commit: 2.6.0 (75) inProgress userFraction 0.2; 2.5.6 (74) completed.
- Contents: PR #111 (26 languages, in-app language picker lists every shipped language, build chat/sign-in errors/tabs/dialogs localized) and #112 (version bump). Translations are machine-made and need native review. The worker prompt change was reverted before merge and the Hetzner worker was not touched.
- Rollback: re-upload 2.5.6 (74) as the completed production release with the same API pattern, or halt the rollout.
