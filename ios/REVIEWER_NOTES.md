# VibeBuild 3.0.0 — App Review Notes

Paste the contents below into App Store Connect → App Review → Notes when
submitting 3.0.0 (build 40). Trim to fit the field if needed.

---

VibeBuild 3.0.0 introduces a Build tab that lets users generate personal
HTML/CSS/JS web projects from a natural-language prompt. Important framing
for review:

PURPOSE & SCOPE
- Each generated project is private to its creator. There is no public
  feed, community browse, or "publish to others" flow in this version.
- Projects are intentionally small personal web apps (todo lists,
  dashboards, calculators, single-page tools). They are not marketplace
  apps.

CONTENT EXECUTION
- Generated projects render exclusively inside our in-app WKWebView at
  prev-<id>.vibebuild.cc. They never download or execute native code.
- WKWebView runs with a non-persistent data store per project (private
  session), JavaScript enabled, no access to device APIs beyond what the
  browser itself permits.
- No installation of standalone apps. No code is run outside WebKit.

MODERATION & UGC
- Apple Guideline 1.2: A first-build EULA modal is shown before any
  prompt is sent. Acceptance is required and stored locally.
- A Report Project action lives in the project preview's toolbar menu
  (mailto abuse@kreativekoala.com). We respond within 24 hours and
  remove violating projects.
- Server-side, prompts are filtered for malicious code patterns and
  cloning/trademark requests before the build is queued. The TTL on the
  preview URL is short-lived and tied to the user's account.

AI DISCLOSURE
- Every preview screen carries a persistent "AI-generated — verify
  before relying on" pill at the top edge.

PURCHASES
- Free users may build 2 projects per day (local counter, resets at
  midnight in the user's timezone). The existing Tinker Pro subscription
  (Monthly $12.99 / Yearly $79.99) removes the cap.
- No new IAPs in 3.0.0.

REVIEWER TEST FLOW (suggested)
1. Open the app, tap the Build tab (sparkles icon).
2. Tap a suggestion chip or type "build a simple to-do list".
3. Tap Generate; accept the EULA on the first build.
4. Wait 2–5 minutes while the project builds (a "Designing layout…"
   spinner cycles).
5. When ready, the WebView opens to your personal app. The AI banner is
   visible at top. You can interact with the generated UI.
6. Tap the toolbar arrow icon to send a tweak (e.g., "make the title
   purple"). The change applies in about a minute and the WebView reloads.
7. Tap Done to dismiss. Open the toolbar tray icon to see My Projects;
   swipe a row to delete.

If the build worker is slow on review day and a preview hasn't loaded by
the time you check, you can still verify the UX by examining the My
Projects list — newly-queued projects appear immediately with a "Building"
badge, which is the intended pre-completion state.

Thank you.
