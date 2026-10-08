# vibebuild.cc web app: redesign spec

Goal: the web app works and looks like the Android app (`android/`), the same journey on a bigger screen and on a phone browser.
Journey: landing, sign in, short welcome (4 steps, skippable), upgrade screen (skipped for subscribers), then the four places: Apps, Create, Explore, Account.
Create is where people land after signing in (as on Android).

## Palette (shared with Android `ui/theme/Color.kt`)

| Role | Value | Tailwind token |
|------|-------|----------------|
| page | `#0E1525` | `bg-background` |
| panel | `#141C2E` | `bg-card` |
| raised (inputs, chips, hovered rows) | `#1C2333` | `bg-surface` |
| line | `#2B3245` | `border-border` |
| text | `#F5F9FC` | `text-foreground` |
| muted text | `#9DA2B0` | `text-muted` |
| quiet text | `#6F7788` | `text-subtle` |
| the action colour (violet) | `#6C63FF`, lighter `#8B83FF`, deeper `#4A42CC` | `bg-accent`, `text-accent-hover` (use for violet TEXT on dark), `bg-accent-deep` |
| live, set, published, success (nothing else uses green) | `#4CAF50` | `text-success` |
| warning / error | `#FF9800` / `#CF6679` | `text-warning` / `text-danger` |

Use the semantic tokens. Never hard-code `#000`, `bg-black`, `text-white/60` or the old cream/ink hex values. Opacity modifiers on tokens work (`bg-accent/15`).
Important: the theme is Tailwind `@theme inline`, so there are no `--color-*` CSS variables at runtime; use the utility classes, not `var(--color-...)`.

## Type

- Headlines, plan prices, app names: `font-display` (Bricolage Grotesque, weights 500 to 800, tight tracking already set by the class).
- Everything else: the default sans (Instrument Sans). One body size, 15px. Line length under 70 characters for reading text.
- Sentence case everywhere ("Create an app", "Sign in"), never Title Case or ALL CAPS. No eyebrow labels above headings. No middle dots joining strings ("A · B · C"). No "→" on buttons. No monospace for labels.

## Shape

One radius per role, not one for everything: controls (buttons, inputs, chips) `rounded-lg`; panels `rounded-xl`; the main prompt composer `rounded-2xl`; avatars and status dots `rounded-full`; the phone-frame preview `rounded-[28px]`.
Separate content with hairlines (`border-border`) and spacing, not by putting every block in its own card. At most one boxed panel per screen section.
Primary action: `bg-accent` with white text, `rounded-lg`. One primary action per screen section.

## Motion

Almost none. Only motion that answers an action (a sheet opening, a row appearing after Save). No fade-and-slide on page sections, no hover lifts. Respect `prefers-reduced-motion` (the global CSS already neutralises animations).

## Quality floor

Works from 360px wide to 1440px. Visible keyboard focus (global `:focus-visible` is set; do not remove outlines). Tap targets at least 40px. Text contrast against `#0E1525`: use `text-foreground` or `text-muted` for reading text, never `text-subtle` for anything essential.
On phones the bottom tab bar is 64px tall: pages already get `pb-16` from the layout; sticky bottom bars must sit above it (`bottom-16 md:bottom-0`).

## Writing

Words only where they help someone act. Active voice. A button names what it does and the result uses the same word ("Publish" then "Published"). Errors say what happened and what to do, with no apology. Empty states point to the next action.

## Shell (already built, do not change)

`src/components/layout/Sidebar.tsx`: left rail on desktop, `BottomTabs` on phones. Tabs: Apps (`/dashboard`, also project pages), Create (`/project/new`), Explore (`/community`), Account (`/settings`). The layout is `src/app/(app)/layout.tsx`.

## Internationalisation

next-intl, 10 languages: en es fr de ja zh ko pt it hi. New copy goes in your own part files so nobody edits the same JSON:
`src/i18n/messages/parts/<part>.<locale>.json`, where `<part>` is one of `landing auth create apps account` (your brief names yours). Write the English first, then translate into the other nine (natural, short UI wording; keep `{placeholders}` exactly; no em or en dashes). The loader merges parts over the base files and falls back to English, so a missing key never shows raw. Existing keys in `en.json` etc. can still be used (`t('common.signOut')`); do not edit the base files except to change an existing string you are replacing in your own area. Keep keys in a top-level namespace named like your part (for example `apps.emptyTitle`).

## Visual check without logging in

A harness fakes a signed-in session and stubs the API. The dev server runs on http://localhost:3100 (started with a dummy Supabase key; it hot reloads).

    node /private/tmp/claude-501/-Users-sushanthtiruvaipati/8075063f-2dfc-4ba0-91e8-1e8b13c9acd4/scratchpad/harness.mjs <name> <path> <width> <height> [--full]

It writes `<scratchpad>/<name>.png`; open it with the image Read tool. It prints page errors and any API call it had no stub for (`unmocked`): if your page needs another API response, copy the harness to your own file and add a route to its `routes` list (do not edit the shared one). Check every screen at 1440x900 and 390x844 and fix what looks wrong before you report.
Only screenshot the pages you own; check the browser shows no page errors.

Type check with `cd web && npx tsc --noEmit` (it must stay clean). Do not run `next build`. Do not commit, push or run git commands that change the tree. Do not touch files owned by someone else (see your brief).

## Android reference

Read the Android source for the behaviour to match: `android/app/src/main/java/com/kreativekoala/vibecoder/ui/` (landing, auth, onboarding, create, apps, account, paywall) and `android/app/src/main/res/values/strings.xml` for the wording.

## Do not invent facts

No made-up numbers, user counts, ratings or testimonials. Prices come from the product: the web Pro plan is $9.99 a month (Android's store prices are different and are not shown on the web).
