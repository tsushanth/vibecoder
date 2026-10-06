# Capacitor APK shell (opt-in)

Second APK template, selected with `shell: 'capacitor'` on `POST /build-apk` (default stays `apk-template/`). Bridges the five `vibe.device` calls (camera, geolocation, share, haptics, isNative) through Capacitor 7.6.9.

## How it is built (no npm, no `npx cap` at build time)

The Android Gradle project was generated once with Capacitor 7.6.9 on a Mac and the library sources are **vendored as local Gradle modules** in `modules/` (about 0.8 MB total), copied unchanged from the npm packages:

| module | npm package |
|---|---|
| `capacitor-android` | `@capacitor/android` 7.6.9 (`capacitor/` folder) |
| `capacitor-camera` | `@capacitor/camera` 7.0.5 |
| `capacitor-geolocation` | `@capacitor/geolocation` 7.1.8 |
| `capacitor-share` | `@capacitor/share` 7.0.4 |
| `capacitor-haptics` | `@capacitor/haptics` 7.0.5 |

Only the module `build.gradle.kts` files are ours (publishing and lint-baseline plumbing removed, Java target lowered from 21 to 17, the box's JDK; the Java/Kotlin sources compile unchanged at 17). Third-party Android dependencies (AndroidX, Cordova framework, play-services-location, ion geolocation) still resolve from Google and Maven Central, so the first build on a host needs network and fills `~/.gradle`; later builds can run `--offline`.

Per build the worker copies this folder, unzips the bundle into `app/src/main/assets/public/`, writes `app/src/main/assets/capacitor.config.json` (`server.hostname` placeholder `__VIBE_HOST__` replaced by `applyCapacitorHost`), rewrites `app_name` and `applicationId`, runs `./gradlew assembleRelease`, then checks the APK permissions with `scripts/check-apk-permissions.mjs` (fails closed).

## Rules baked in

- Permissions: INTERNET, CAMERA (camera feature not required), ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION, VIBRATE. READ_MEDIA_* and READ/WRITE_EXTERNAL_STORAGE are removed with `tools:node="remove"`.
- No minify/R8, release not debuggable, no cleartext, `allowNavigation` and `server.url` unset (they would widen the bridge origin).
- Signing: `APK_KEYSTORE_PATH`, `APK_KEYSTORE_PASSWORD`, optional `APK_KEY_ALIAS` from the environment. No key in git and no fallback key: a release build without them fails.
- Requires JDK 17, Android SDK platform 35 and build-tools, Gradle 8.11.1 (wrapper, downloaded on first use).

## Upgrading Capacitor

In a scratch dir run `npm i @capacitor/{core,android,cli,camera,geolocation,share,haptics}@<version>`, `npx cap add android`, then replace `modules/*/src` from `node_modules/@capacitor/*/android/src` (and `android/capacitor/src`) and re-check the permission test.
