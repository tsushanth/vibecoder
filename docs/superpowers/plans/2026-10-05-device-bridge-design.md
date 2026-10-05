# Device bridge (Capacitor) design

Date: 2026-10-05. Status: design only. No product code changed, nothing deployed, Play Store untouched. Implements block 9 of `docs/superpowers/specs/2026-10-04-vibebuild-tier1-building-blocks-scope.md`.

Evidence labels used below: **read** = read in this repo or in the published npm tarballs (fetched with `npm pack`, unpacked and grepped, nothing installed or built); **claimed** = stated in a comment or doc but not run; **unmeasured/unverified** = I could not or did not test it. Sizes S/M/L follow the scope doc (S = days, M = 1 to 2 weeks, L = 3+ weeks, my estimates).

## 0. Summary and recommendation

- Build `vibe.device` with five calls (plus two reserved for push), add a Capacitor-based APK template next to the existing one, and keep the old WebView template as a fallback behind a flag. Defer push.
- The biggest finding is not about Capacitor: **the APK template does not exist in this repo, and the checked-in worker image cannot build an APK.** Phase 0 (recover and version the build environment) is a hard prerequisite, and it is the real cost of block 9.
- The bridge can be made origin-safe cheaply: serve the APK's local assets under `https://<appId>.vibebuild.cc` (Capacitor `server.hostname`) so the WebView origin equals the web origin, the existing platform proxy CORS rule and `vibe.js` app-id detection keep working unchanged, and Capacitor's origin-restricted message channel is scoped to that one origin.

## 1. How APK export works today (read)

Pipeline, with files:

1. Creator app (Android client) calls `POST api/projects/{id}/export-apk` with `{userId, bundle?}` (`android/app/src/main/java/com/kreativekoala/vibecoder/data/remote/VibeBuildApi.kt` L103-108; `ProjectRepository.kt` L183; `ui/apps/ProjectDetailViewModel.kt` L384-403 decodes the base64 APK and saves it to Downloads). No web or iOS caller was found (`backend/docs/output-types-findings.md`).
2. Backend (`backend/routes/projects.routes.js` L1660-1734) loads the project, takes the bundle from the client, else the DB `bundle` column, else the worker's `/bundle/<repo>`, then calls `POST ${WORKER_URL}/build-apk` with `{projectId, bundle, appName}` and a 180 s timeout. It does compare `project.creator_id` to the request's `userId` (L1678), but `userId` is client-supplied in the body with no session check, so the ownership check is only as good as that trust (`backend/docs/output-types-findings.md` says export-apk has no ownership check; the code at L1678 does have this comparison, so that note is slightly out of date). It logs `result.buildTime` but the worker never returns that field.
3. Worker (`worker/server.js` L936-996): one build at a time (`activeApkBuilds >= 1` returns 429). It copies `worker/apk-template/` to a temp dir, unzips the bundle into `app/src/main/assets/` (`unzipBundle`, L310), rewrites the app name in `res/values/strings.xml` and `applicationId = "com.vibebuild.export"` to `com.vibebuild.app.a<projectId, 20 chars>` in `app/build.gradle.kts`, runs `./gradlew assembleRelease` (180 s timeout; env `ANDROID_HOME=/opt/android-sdk`, `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`), reads `app/build/outputs/apk/release/app-release.apk` and returns it base64 inside JSON.
4. The APK is therefore "the generated static bundle as Android assets plus a WebView shell". There is no native bridge, no JS interface and no Capacitor/TWA/Bubblewrap anywhere in the repo (grep for gradle, apk, twa, webview, bubblewrap, android-sdk).
5. **Gaps (read, important):**
   - `worker/apk-template/` is **not in git** (not in any branch history, not in `.gitignore`, absent from the working tree). The only source of truth is whatever sits on the hand-provisioned Hetzner worker (`178.156.231.255`, bare PM2 process at `/home/vibecoder/worker/`, per the infra memory note). I tried to read it over SSH and the connection timed out, so **the template contents (WebView settings, manifest, signing config, minSdk) are unverified**.
   - `worker/Dockerfile` installs only node, curl, git and the Claude CLI. No JDK, no Android SDK. As checked in, the image cannot run `/build-apk`.
   - The deployed worker has drifted from `worker/server.js` (infra note), so the L936-996 code may not be what runs in production.
   - Signing: `assembleRelease` yields an installable APK only if the template has a signing config. Unknown without the template.
   - The "Gradle takes ~60s" figure is a code comment, not a measurement. The worker log line `APK ready: N MB` exists, but I did not have logs. The scope doc says 115 APK builds were logged.
   - The base64 APK inside one synchronous JSON response, with a single build slot, is a scaling and memory risk that gets worse if the APK grows.

## 2. The `vibe.device` API (5 calls now, 2 reserved; limit was 8)

Namespace: `vibe.device`, delivered inside `vibe.js` (same bundled, platform-owned file as `vibe.api`, `vibe.ai`, `vibe.auth`, per `2026-10-05-vibe-sdk-worker-integration.md`; model-written copies are already stripped). All calls return Promises. Errors reject with an `Error` carrying `status = 0` and `code`, matching the existing `vibe.js` error shape. Codes: `bad_request`, `cancelled`, `denied`, `unsupported`, `timeout`, `unavailable`.

| # | Signature | Resolves | Web fallback | APK (Capacitor plugin) |
|---|---|---|---|---|
| 1 | `vibe.device.isNative()` -> `boolean` (sync) | true only inside the APK | always false | true |
| 2 | `vibe.device.camera.capture({facing?: 'environment'\|'user', maxWidth?: 64..4096 (1280), quality?: 1..100 (80)})` | `{dataUrl, mimeType, size}` | hidden `<input type=file accept=image/* capture=...>`, FileReader; `cancel` event or empty selection rejects `cancelled`; non-image or over 8 MB rejects `bad_request` | `@capacitor/camera` `getPhoto({resultType:'dataUrl', source:'CAMERA', width, quality, saveToGallery:false})` |
| 3 | `vibe.device.geolocation.get({highAccuracy?: bool, timeoutMs?: 1000..60000 (15000), maxAgeMs?: 0..600000 (60000)})` | `{lat, lng, accuracy, timestamp}` | `navigator.geolocation.getCurrentPosition`; error code 1 maps to `denied`, 3 to `timeout` | `@capacitor/geolocation` `getCurrentPosition` |
| 4 | `vibe.device.share({title?, text?, url?})` (at least one; url must be http/https) | `{shared, copied}` | `navigator.share`; user abort resolves `{shared:false}`; else `navigator.clipboard.writeText`, resolves `{copied:true}`; else `unsupported` | `@capacitor/share` `share` |
| 5 | `vibe.device.haptics.tap(kind)`, kind in `light, medium, heavy, success, warning, error` | `{ok}` (best effort, never rejects for missing hardware) | `navigator.vibrate(pattern)`; `ok:false` when absent | `@capacitor/haptics` `impact` (light/medium/heavy) or `notification` (success/warning/error) |
| 6 (reserved) | `vibe.device.push.register()` | n/a in v1: rejects `unavailable` | none | see section 6 |
| 7 (reserved) | `vibe.device.push.onMessage(fn)` | n/a in v1 | none | see section 6 |

Design choices worth challenging:

- Camera returns a data URL, not a File or blob. It is the only form that works identically from a plugin and from `FileReader` and survives `JSON.stringify` into `vibe.storage.upload` or an `<img src>`. The cost is memory: a 1280 px JPEG at quality 80 is typically a few hundred KB (my expectation, unmeasured). The 8 MB web cap and the `maxWidth` default exist to keep apps from OOMing the WebView. The web path does not downscale (the browser file input returns the full photo); a canvas resize step is a follow-up.
- No `watchPosition`, no gallery picker, no file save, no clipboard read, no contacts, no background anything. Each addition is a new permission and a new abuse surface. Gallery pick is also the call that drags in `READ_EXTERNAL_STORAGE`/`READ_MEDIA_*` (see 4.3), so excluding it is what keeps the owner's permission rule easy.
- `haptics.tap` never rejects for missing hardware because games call it on every tap and should not need try/catch.

### Prototype (built and tested, throwaway)

`docs/superpowers/prototypes/vibe-device/device.js` (ES5, no dependencies, not wired into `platform/sdk/vibe.js`) implements calls 1-5 with the fallbacks and Capacitor paths above. `device.test.js` loads it into a fresh Node `vm` context per test with a fake `window`, so no browser or device is involved. Run: `node docs/superpowers/prototypes/vibe-device/device.test.js`. Result: 22 of 22 pass. Covered: web fallbacks for each call, error mapping (denied, timeout, cancelled, unsupported), bad arguments rejected before any browser or plugin call (non-objects, arrays, NaN, out-of-range numbers, `javascript:`/`data:`/`file:` share URLs, unknown share options, unknown haptic kinds including `__proto__`), `saveToGallery:false` and rear camera defaults on the native path, a page that defines its own fake `window.Capacitor` is not treated as native, and plugin lookup through both `Capacitor.Plugins` and `Capacitor.registerPlugin`.

What the prototype does **not** prove: nothing ran in a real browser, a real WebView or against real Capacitor plugin objects. The fakes encode my reading of the plugin API (`getPhoto`, `getCurrentPosition`, `share`, `impact`, `notification`), which I did not execute. Whether `Capacitor.Plugins.<Name>` exists in a plain script page without a bundler, or only `Capacitor.registerPlugin('<Name>')`, is **unverified** (the prototype tries both).

## 3. Runtime detection without breaking web-served apps

- Detection is `window.Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform() === true`, evaluated per call, never cached, wrapped in try/catch. Capacitor injects `window.Capacitor` into the page in the native shell only; on `<app>.vibebuild.cc` it does not exist, so `isNative()` is false and the web path runs. Apps never need a build flag.
- A page that fakes `window.Capacitor` gains nothing: the real bridge is the only thing that can reach native code, and plugin calls still go through the permission checks in section 5. The prototype treats a fake without a working `isNativePlatform` as web.
- If the flag says native but the plugin is missing (older APK, plugin not included), the call falls through to the web path instead of throwing. This is what makes **old app versions keep working**: old plain-WebView APKs never define `Capacitor`, so a new bundle running in an old APK takes the web path, and an old bundle's SDK in a new APK never calls `vibe.device`.
- Old APKs are standalone files on users' phones and are not updated by this work. Nothing server-side can break them: the `/build-apk` request and response shape stays identical (section 4.5).
- App identity: today `vibe.js` derives the app id from `location.hostname` ending in `.vibebuild.cc` (`platform/sdk/vibe.js` L16-17) and the platform proxy only allows origin `https://<appId>.<baseDomain>` or the app's registered domains (`platform/proxy-app/server.js` L15-18). Capacitor's default WebView origin is `https://localhost`, which would be rejected by the proxy with `origin_not_allowed`. Fix without touching the proxy: set Capacitor `server.hostname` to `<appId>.vibebuild.cc` (CapConfig has `hostname`, default `localhost`; read in `CapConfig.java`). The WebView then serves the packaged assets at `https://<appId>.vibebuild.cc`, `vibe.js` derives the right id, and the CORS check passes. Alternatives are baking `window.VIBE_APP_ID` (the SDK already honours it) and adding `https://localhost` to the proxy allow-list, which weakens the origin rule for every app. Recommendation: hostname trick. **Unverified on a device**: I expect local assets to shadow the real site inside the APK and cross-host fetches to the proxy to go out normally.

## 4. Build changes

### 4.1 Approach

Do not run the Capacitor CLI or `npm install` per build. Pre-bake a pinned Android project template (Capacitor Android library, plugins, Gradle wrapper, dependency cache) into the build image. Per build, the worker does what it does today: copy the template, write the bundle into `app/src/main/assets/public/`, write `capacitor.config.json`, set app name and `applicationId`, run Gradle. That keeps untrusted creator content away from npm install scripts and keeps the build offline and reproducible.

### 4.2 Versions (read from the published tarballs on 2026-10-05)

`@capacitor/android` 8.5.2 (Gradle plugin `com.android.tools.build:gradle:8.13.0`, `compileSdk 36`, `minSdk 24`, `targetSdk 36`, **Java 21 source/target compatibility**), `@capacitor/core` 8.5.2, `camera` 8.2.5, `geolocation` 8.2.3, `share` 8.0.3, `haptics` 8.0.2, `push-notifications` 8.1.3.

Consequence: the worker's hard-coded `JAVA_HOME` is JDK **17**. Capacitor 8 needs JDK 21 plus Gradle 8.13+ and Android SDK platform 36 and matching build-tools in `/opt/android-sdk`. Either install those or pin an older Capacitor major that targets JDK 17 (not checked which one). Pin whichever is chosen with a lockfile.

### 4.3 Plugin set and Android permissions (read from plugin manifests and sources)

| Call | Plugin | Manifest declarations the app must add | Notes |
|---|---|---|---|
| camera | `@capacitor/camera` | `CAMERA` | The plugin manifest declares only `<queries>`, no permissions; its `CameraPlugin.kt` requests `CAMERA` at run time for `source: CAMERA`. Its `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` aliases are used only for gallery/save paths, which we never call (`source` fixed to CAMERA, `saveToGallery:false`). |
| geolocation | `@capacitor/geolocation` | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` (README says the app must declare them; the plugin manifest has none) | Coarse only is possible if `highAccuracy` is dropped; start with both. |
| share | `@capacitor/share` | none | |
| haptics | `@capacitor/haptics` | `VIBRATE` (declared by the plugin; a normal permission, no prompt) | |
| all | core | `INTERNET` | already present in the current wrapper's needs. |

Owner rules, enforced in the build, not by convention:

- **Never declare `READ_MEDIA_*`.** None of the five plugins above declares it (grep of all plugin manifests and sources found only `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` aliases in the camera plugin, no `READ_MEDIA_*`). To be safe the template manifest adds `tools:node="remove"` entries for `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, and the build fails if `aapt2 dump permissions` on the finished APK lists any of them. Future plugin upgrades then cannot sneak one in.
- **Never enable minify/R8.** Template keeps `isMinifyEnabled = false` and `isShrinkResources = false` for `release`; the post-build check also asserts this in the generated `build.gradle.kts` before running Gradle. Consequence: no shrinking, so the APK is larger than a typical Capacitor release.
- Least privilege per app: before building, scan the bundle text for `vibe.device.camera`, `vibe.device.geolocation` and `haptics`, and add only the matching permissions. Dynamic access such as `vibe.device['camera']` evades the scan and then fails closed (the call is rejected `denied`), which is the right failure direction. Push (when it exists) adds `POST_NOTIFICATIONS` the same way.

### 4.4 Capacitor config (security-relevant, see section 5)

`capacitor.config.json` is written by the worker, never taken from the bundle: `appId` = the existing `com.vibebuild.app.a<id>`, `appName`, `webDir: "public"`, `server: { androidScheme: "https", hostname: "<appId>.vibebuild.cc" }`, no `server.url`, no `server.allowNavigation`, `android: { allowMixedContent: false, webContentsDebuggingEnabled: false, loggingBehavior: "none" }`, `CapacitorHttp` and `CapacitorCookies` disabled (they are off by default; they add extra JS interfaces when on).

### 4.5 Pipeline integration (no API change)

- Template lives in the repo (Phase 0), selectable by env `APK_ENGINE=capacitor|webview` on the worker, with a per-request fallback to the webview template if the Capacitor build throws, so export never gets worse than today.
- `POST /build-apk` request and response stay byte-compatible (`{success, apk(base64), apkSize}`), so all released creator-app versions keep working. Later (separate item): return a storage URL instead of a base64 body, and add `buildTime`, which `projects.routes.js` L1728 already logs but never receives.
- The worker validator that checks generated apps (see the vibe.js integration decision) learns `vibe.device.*` the same way it knows `vibe.api`: require `<script src="vibe.js">`, and run the headless check with the real SDK so web fallbacks execute in Chrome (camera and share never resolve headlessly; the check must only look for thrown errors, not wait on them).
- Generator prompt addition (small): "call `vibe.device.*` only on a user gesture, handle `denied`, `cancelled` and `unsupported`, never assume the camera or GPS exists".

### 4.6 Build time and APK size

**Unmeasured.** I did not run a Capacitor build: this Mac's data volume was at 100% (about 0.8 GB free, `df` at the time) and a first Gradle build with the Android dependency cache needs several GB, which is not safe on a shared machine. Reasoned expectations only, to be replaced by a measurement in Phase 0: Gradle time is dominated by Kotlin/Java compile of the Capacitor library and four plugins plus dexing; with a warm Gradle cache on the worker I expect it to be modestly slower than the current plain wrapper, not minutes slower. APK size: the current plain WebView wrapper is small because it has almost no code; a non-minified Capacitor APK pulls in AndroidX core, appcompat, webkit, activity and Capacitor's own classes, so I expect low single-digit MB growth versus today, but that is a guess. Cold cache (first build on a new image) is much slower and downloads the whole dependency set. The 180 s timeout and one-build queue need to be rechecked against the measurement; cold builds could exceed 180 s.

## 5. Security

Threat model: the generated app is untrusted code (a creator's prompt can produce phishing, trackers, hidden camera abuse). The APK is installed by the end user, who grants permissions to "the app".

Verified in the Capacitor 8.5.2 source (read):

- The bridge channel (`androidBridge`) is registered with `WebViewCompat.addWebMessageListener(..., bridge.getAllowedOriginRules(), ...)` and only the **main frame** can execute plugins (`MessageHandler.java`: "Plugin execution is allowed in Main Frame only"). Allowed origins are built from `scheme://hostname` plus, **if configured, every `server.allowNavigation` entry and `server.url`** (`Bridge.java` L240-249). Therefore: never set `allowNavigation` or `server.url`, or you widen the bridge to those origins.
- **Fallback hazard:** if the device WebView does not support `WEB_MESSAGE_LISTENER`, or `addWebMessageListener` throws, Capacitor falls back to `addJavascriptInterface(this, "androidBridge")` (`MessageHandler.java` L36-41), which is reachable from every frame regardless of origin. Mitigations: inject a meta CSP (`default-src 'self'` plus the vibe proxy host in `connect-src`, `frame-src 'none'`, `object-src 'none'`) at build time, and have the worker keep rejecting external fetches/iframes in generated code (the existing external-dependency check). Also set a minimum WebView version in the manifest/docs. Residual risk: moderate on very old WebViews; **verify on a device** that a cross-origin iframe cannot reach the bridge.
- No arbitrary URL loading: the shell never sets `server.url`. External links open outside the WebView by default in Capacitor (not tested here); keep that default and test it.

What a malicious app can do with each call (all gated by an Android runtime prompt on first use, shown at the moment of the call; the SDK never pre-requests):

| Call | Worst case | Containment |
|---|---|---|
| camera.capture | Takes a photo the user explicitly takes via the system camera UI, then exfiltrates it over `fetch` to a server. | System UI shows what is captured and requires a shutter press; no preview-less capture exists; no background capture; data URL goes only to the app's own JS. Exfiltration to arbitrary hosts is limited by the CSP above and by the pre-publish scanner (scope doc, cross-cutting). Not fully preventable if the bundle may call arbitrary hosts. |
| geolocation.get | Repeated location polling, location sent to a tracker. | One-shot only, no `watch`, no background permission; coarse or fine per user choice; repeated calls are possible while the app is open. Rate limit in SDK is cheap to add (S). |
| share | Opens the share sheet with attacker-chosen text (spam/phishing link). | User must pick a target and confirm; url restricted to http(s); length caps; no files; no silent send. Cannot send without user action. |
| haptics.tap | Nuisance vibration. | `VIBRATE` is a normal permission; kinds are an enum; cost is annoyance only. |
| push (deferred) | Spam notifications to every installed user, phishing via notification text. | Section 6: server-side send only, per-app caps, kill switch. |

Other controls: do not enable the plugin set beyond the five; no `@capacitor/filesystem`, `browser`, `app-launcher`, `http`, `preferences`. Debugging disabled in release. Per-app permission derivation (4.3) means an app that never uses the camera does not even declare `CAMERA`. The owner's no-READ_MEDIA and no-minify rules are enforced as build assertions. Signing key handling is the template's open question (section 1) and must never be committed.

## 6. Push notifications

What it would need:

1. **FCM per generated app.** Each APK has its own `applicationId`, and FCM needs a `google-services.json` entry for that package name. A shared applicationId is not an option (all installs would collide). So either register one Android app per export in a Firebase project through the Firebase Management API (service account with Firebase admin rights, per-export API calls, and a documented cap on apps per Firebase project, which I believe is about 30 and is **unverified**, meaning multiple Firebase projects and a rotation scheme), or push is unavailable for generated apps. This is the hard part, not the plugin.
2. Build: add `@capacitor/push-notifications` (8.1.3; it pulls `firebase-messaging` 25.0.1 and registers a `MessagingService` in the manifest, read), apply the Google Services Gradle plugin and inject the per-app `google-services.json`, add `POST_NOTIFICATIONS`. This is a second template variant ("with push"), with a larger APK and a Firebase dependency on every push-enabled build.
3. Platform proxy route: `POST /<appId>/push/register {token, platform:'android'}`, authenticated by the end user's `vibe.auth` session when present (else an anonymous device id), storing `(app_id, user_id?, token, created_at, last_seen)` in the platform database with per-app token caps and deduplication, plus unregister on sign-out. Origin rule is the same as the other routes.
4. Sending: server-side only, never from the browser. Through the notification service being built by another agent. **I found no such service or branch in this repo** (searched branches and code for notification/push/email work; the only push code is `backend/services/pushService.js`, which sends FCM and email to *creators* for the creator app, using the creator app's own Firebase project, and cannot deliver to generated apps' tokens). So the contract here is an assumption: the notification service exposes a `sendPush(appId, {userIds|all}, {title, body})` function that the app's server-side function (block 2) calls, with per-app quotas, rate limits and the kill switch from the scope doc, section 8.
5. Web Push is not a substitute inside the APK: Android WebView does not support the Push API, so PWA push would be a separate path for the web-served app.

**Recommendation: defer push.** It is the only call in block 9 that needs new vendor surface (Firebase project(s) and per-export registration), a stateful route, a quota and abuse system and a dependency on another team's service whose contract I could not see, while camera, geolocation, share and haptics need none of that. Ship email notifications (block 8) first. Keep the `push.*` names reserved so the SDK surface does not change later. Revisit when the notification service exists and when there is evidence that generated apps need push (the scope doc's demand analysis counted native features at 3 of 27 prompts without breaking out push).

## 7. Phased plan

| Phase | What | Size | Notes |
|---|---|---|---|
| 0 | **Recover and version the build environment.** Get `apk-template/` off the worker box into the repo (no keystore in git), document or script the host (JDK, `/opt/android-sdk`, Gradle cache), add a build image or setup script, confirm signing, measure current build time and APK size from worker logs. | M | Blocker for everything. Needs SSH to `178.156.231.255` (timed out for me) and a decision on which host builds APKs. |
| 1 | `vibe.device` in `vibe.js` (promote the prototype, add to the real SDK tests and the worker's sync check), generator prompt, validator support, headless web-fallback check. Works in browsers and the old APK immediately. | S | No native work; ships value on the web (share, geolocation, camera, vibrate) even before Capacitor. |
| 2 | Capacitor template, pinned plugin set, hostname trick, CSP injection, permission derivation, `aapt2` and no-minify assertions, `APK_ENGINE` flag with fallback. Measure build time and size locally and on the worker. | M | Needs JDK 21 and SDK 36 on the build host (or an older Capacitor pin). |
| 3 | On-device verification matrix (section 8) on at least one real phone and one old-WebView emulator; flip the default engine to capacitor. | S | Needs a physical Android device and approval to sideload test APKs. |
| 4 | Push (only if approved): Firebase registration, push template, register route, send via notification service. | L | Deferred, see 6. |
| Later | Return the APK by URL instead of base64 JSON; queue builds; gallery picker only if demand and permissions policy allow. | M | |

Total for phases 0-3: roughly L when Phase 0 is included, versus the scope doc's M for block 9 alone; the difference is the missing template and build environment.

## 8. Risks and verification still owed

1. Template and build host unknown (largest risk; could be broken in prod today, and the deployed worker drifted from the repo).
2. `Capacitor.Plugins.<Name>` versus `registerPlugin` without a bundler: unverified.
3. The hostname trick (origin equals `https://<appId>.vibebuild.cc`, local assets shadow the site, proxy CORS passes): unverified on a device.
4. Cross-origin iframe cannot reach the bridge, including the `addJavascriptInterface` fallback path: unverified.
5. Camera plugin on Android 13+ with only `CAMERA` declared and no storage permissions behaves correctly: expected from the source, unverified.
6. Build time, cold and warm, and APK size: unmeasured. The 180 s timeout may be too tight cold.
7. JDK 21 and SDK 36 on the worker host: not checked (the code hard-codes JDK 17).
8. Merged-manifest check: confirm no `READ_MEDIA_*`/storage permissions in the final APK (assertion in 4.3 makes this automatic once built).
9. Generated apps may call the camera on page load, scaring users and causing store/reputation problems; the prompt rule helps but is not enforcement.
10. Distribution: APKs are sideloaded from Downloads, not Play. If that ever changes, Play's target API, data-safety and permission-declaration rules apply to every generated package and the camera/location permissions will need declared justification. Not in scope; Play Store untouched.
11. Prompt-injected generation could attempt to read `window.Capacitor` internals or call plugins directly (`Capacitor.Plugins.Filesystem` does not exist because it is not included; included plugins are reachable without `vibe.device`). The SDK wrapper adds validation, not isolation: a malicious app can bypass it and call the plugin directly. The security boundary is the permission prompts and the plugin set, not the SDK.

## 9. Decisions and spend needed from the owner

Decisions:

1. Approve Phase 0 first: which host builds APKs (keep the Hetzner box, a dedicated build image on Fly or elsewhere), and permission to read/copy the template and signing setup off the box. Is the current APK signing key the one users' installs depend on? (A different key breaks in-place updates of old installs.)
2. Capacitor engine as default after verification, with the old WebView template kept as fallback: yes or no?
3. Defer push: yes (recommended) or proceed to Firebase registration work?
4. The five-call surface (camera, geolocation, share, haptics, isNative): add or drop anything? In particular gallery pick (adds storage permissions the owner rule makes awkward) is deliberately excluded.
5. Capacitor major: current 8.x (needs JDK 21, SDK 36, Gradle 8.13+) or an older pin that fits JDK 17.
6. Whether `https://<appId>.vibebuild.cc` as the in-APK origin is acceptable (it makes the APK serve its own copy of that hostname offline) versus adding `https://localhost` to the proxy allow-list.

Spend (all small, none committed):

- Build host changes: no new recurring cost if the existing Hetzner box is reused (extra disk for JDK 21, SDK 36 and the Gradle cache, a few GB; check the server's free disk first). A dedicated build service would be new recurring spend.
- A physical Android test device or emulator time for Phase 3 (the owner may already have one).
- Push only: Firebase project(s) (free tier, but possibly several projects and a service account) and the engineering above. Not needed unless push is approved.
- No Play Store fees, no new LLM spend.

## Decisions (owner delegated, 2026-10-05) and Phase 0 findings

Phase 0 findings from the template recovered from box 231 (backup in the owner's private folder, now committed as `worker/apk-template/`):
- Every exported APK is signed with the public Android **debug keystore** (`app/debug.keystore`, password `android`). It is the same key for every app and is not secret. Existing installs therefore depend on that key; changing it would stop updates for them.
- minSdk 24, targetSdk 34, Gradle 8.5, JDK 17, Kotlin; `isMinifyEnabled = false` (matches the standing rule). Permissions: INTERNET only.
- The WebView loads `file:///android_asset/index.html` with universal file access and remote debugging on. Pages there send `Origin: null`, which the platform proxy rejects, so **exported APKs of apps that use vibe.auth, vibe.db, vibe.storage, vibe.pay or vibe.notify cannot work today**. Serving the APK at `https://<app>.vibebuild.cc` (decision 7) fixes this.

Decisions taken (owner: "your call"):
1. **Build host:** stay on box 231 (it already has the JDK and Android SDK). Template is now in git so the box is reproducible; the Dockerfile/box provisioning for JDK and SDK is the next step before any host move.
2. **Signing key:** keep the debug key for existing installs and for now for new ones (changing it breaks updates). Follow-up, needs a decision before Play distribution: per-app release keys. Note the risk: anyone can sign an APK with the public key and the same package name, so these sideloaded exports must never be presented as tamper-proof.
3. **Capacitor default:** yes, after verification, with the old template kept as the fallback behind a flag.
4. **Push:** deferred.
5. **API:** five calls (isNative, camera.capture, geolocation.get, share, haptics.tap).
6. **Capacitor version:** pin the 7.x line, which builds with JDK 17 (the box's current JDK), instead of 8.x which needs JDK 21 and SDK 36. Revisit when the box gets JDK 21.
7. **Origin:** the APK serves itself at `https://<app>.vibebuild.cc` (Capacitor `server.hostname`), which the proxy already accepts.

Next steps (not started): fix the file:// origin problem with a minimal change to the existing shell (load the bundled files via a WebViewAssetLoader at https://<app>.vibebuild.cc so the proxy accepts the origin), turn off universal file access and remote debugging in release builds, then the vibe.device SDK, then Capacitor.
