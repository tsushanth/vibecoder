# Output types (Gap #5): findings

Investigation only, no code changed. Line numbers are approximate; other agents were editing concurrently.

## Current state

Every generated project is a static, dependency-free web bundle (index.html plus css/js) stored and passed around as a base64 ZIP.

- Generation contract: the worker's `CLAUDE_MD` prompt (`worker/server.js`, ~L285-330) forces "self-contained web app", "No CDNs", "No node_modules", "Pure browser project. No npm, no bundlers."
  This is the real output-type constraint. It is prompt-level, not config-level.
- `framework` is a dead parameter. Clients send `framework: 'react'` (`web/src/app/(app)/project/new/page.tsx:93`, `web/src/types/api.ts:24`).
  The backend forwards `framework || 'react'` to the worker (`backend/routes/projects.routes.js` ~L525, ~L919 hardcodes 'react').
  The worker's `/generate` destructures only `{prompt, userId, stream, referenceImage, callbackUrl, callbackSecret}` (`worker/server.js` ~L899) and never reads it.
  `/api/projects/save` accepts `framework` and ignores it (no DB column). So the worker supports exactly one "framework": vanilla static web, regardless of the value passed.
- Web/PWA output: `POST /api/deploy` (`backend/routes/deploy.routes.js`) sends the ZIP to `deploy-server/server.js`, which unzips into Supabase Storage and serves it at `<subdomain>.vibebuild.cc` (plus custom domains). `/api/deploy/preview` does the same for temporary previews. `deploy-server` is a pure static host: no build step, no Node runtime for user code.
- Android APK export: `POST /api/projects/:id/export-apk` (`projects.routes.js` ~L1424) gets the bundle (client-supplied, DB, or worker `/bundle/<repo>`) and forwards to worker `POST /build-apk` (`worker/server.js` ~L2340).
  The worker copies `worker/apk-template/`, unzips the bundle into `app/src/main/assets/`, rewrites `strings.xml` app name and `applicationId` (`com.vibebuild.app.a<projectId>`), runs `./gradlew assembleRelease` (180s timeout, `MAX_APK_BUILDS = 1`, so one build at a time per worker), and returns the APK base64 in JSON.
  In effect it is a WebView wrapper around the static bundle. Android client: `VibeBuildApi.kt` L96. No web/iOS caller of export-apk was found.
- Repo/infra gaps that affect this:
  - `worker/apk-template/` does not exist in the repo (only referenced at `worker/server.js` ~L2338; gitignored or untracked).
  - `worker/Dockerfile` installs only node, curl, git and the Claude CLI: no JDK 17, no Android SDK at `/opt/android-sdk`, no template. As checked in, `/build-apk` cannot succeed in that image. It must run on a hand-provisioned host, or it is broken in prod. Verify which.
  - `assembleRelease` needs a signing config to yield an installable APK; not visible without the template. Unsigned release APKs will not install. Verify.
  - The APK path does a synchronous 3-minute HTTP request through Fly to the worker with a single build slot. That is a scaling and timeout risk (and a base64 APK inside JSON).
  - iOS: no export path exists. The iOS app is a viewer (`ios/`), and App Store distribution of user-generated wrappers is a policy problem in itself.
- Auth caveat: export-apk and most project routes trust a client-supplied `userId`, with no session verification, and export-apk does not even check that `userId` owns the project. Fix before exposing more export types.

## Options, ranked by effort and risk

1. Make current output honest and finish it (days, low risk). Stop sending/accepting `framework` (or reject unknown values), and add `output_type` metadata only if needed.
   Fix APK build reliability: bake JDK + Android SDK + template + signing config into a dedicated build image or service. Move APK builds off the request path (queue + poll, upload the APK to Storage and return a URL). Add the ownership check.
2. PWA export (days, low risk). Add `manifest.webmanifest`, an icon set, and a service worker injected into the bundle at deploy/export time. "Installable on any phone" with zero store friction, and reuses deploy-server. Best value per effort for "output types".
3. Capacitor or Cordova-style wrapper (about 1-2 weeks, medium risk). Same static bundle in a Capacitor shell. This gives plugin access (camera, push, haptics) beyond a bare WebView, and can also target iOS/Android from one template. Still needs Android SDK on the build host, and Xcode plus Apple signing on macOS for iOS (cannot run in a Linux container).
4. Multi-file framework output such as Vite + React or Next (about 2-4 weeks, medium-high risk). Requires relaxing `CLAUDE_MD`, adding `npm install` and `vite build` to the worker pipeline, dependency and network policy (currently "no CDN/no npm" for safety and offline use), build caching, and sandboxing of untrusted `package.json` install scripts. The verify phase and `unzipBundle`/tweak/customize flows assume a flat static tree and would all need to handle source-vs-dist. Also changes the GitHub versioning and diffs.
5. Expo / React Native output (about 4-8+ weeks, high risk). Not a static bundle: needs Metro/EAS builds (EAS is a paid third-party service and needs Expo credentials and Apple/Google accounts), a separate generation prompt and template, a different preview path (Expo Go or an Expo web export, since deploy-server only serves static files), and per-project native build queues. The LLM's RN output is also less reliably correct without running it. The existing WebView/APK path cannot be reused.

## Recommendation

Do 1 then 2 now: reliable APK export (queued and signed) and PWA install support. That covers "get my app on a phone" without changing generation. Treat 3 as the next step only if users ask for native capabilities or iOS. Defer 4 and 5 until there is demand data. They are a platform pivot (new prompts, build sandbox, cost model at ~$0.044/min), not a feature.
Do not add a `framework` selector in the UI until the worker actually honors it.
