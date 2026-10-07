# Android: app keys screen (and later usage) for creators

Status: plan only, nothing built. Date: 2026-10-07.

## Why

A generated app can declare connectors that need the creator's own key (a third-party API, or Stripe for apps that sell things).
On the web a creator enters those keys in the project's Keys panel (`web/src/components/project/SecretsPanel.tsx`). The Android
app (`com.kreativekoala.vibecoder`, 2.4.1 / versionCode 67) has no such screen. Its project screen offers Deploy, Preview, Export APK,
Share and Domain. So an Android-only creator whose app needs a key gets `secret_missing` at runtime and has no way to fix it.
Verified by reading the code on 2026-10-07; no on-device test was possible because the screen does not exist.

## Goal and non-goals

Goal: an Android creator can see which keys their app needs, which are set, and set, replace or remove each one.

Not in this plan: reading a key back (the platform is write-only by design), schema-change confirmation, billing screens, the iOS app
(it has the same gap and should get the same screen after Android proves the shape).

## Backend: nothing to build

The three routes already exist, are owner-only and verified by access token, and the Android client already sends the token (PR #13):

| Call | Body | Answer |
|------|------|--------|
| `GET /api/projects/{id}/secrets` | none | `{ secrets: [{ name, updatedAt }], required: [{ name, connectors: [..], purpose? }], pay?: { webhookUrl } }` |
| `PUT /api/projects/{id}/secrets/{name}` | `{ "value": "..." }` (1 to 4096 chars) | 204 |
| `DELETE /api/projects/{id}/secrets/{name}` | none | 204 |

Errors: 401 sign in again, 403 not the creator, 404 or 503 means the app has no key support (hide the row, as the web panel does),
429 `rate_limited`, 502 `secret_store_unavailable` (offer retry), 400 `invalid_value`. Names are UPPER_SNAKE_CASE.

## Android changes

1. **API and models** in `data/remote/VibeBuildApi.kt` and `data/model/`: the three calls above plus `SecretsResponse`,
   `SecretInfo`, `RequiredSecret`, `PayInfo`. Parsing is covered by extending `ModelParsingTest`.
2. **Repository**: `SecretsRepository` (list, set, remove) returning a small sealed result, so the view model never sees raw HTTP.
3. **View model**: `AppKeysViewModel` with states `Loading`, `Hidden` (404 or 503), `Error(retry)`, `Ready(rows)`. Each row has
   name, used-by connectors, optional purpose hint, `isSet`, and a transient `busy` or `note`. A draft value lives only in the field
   state, is cleared on save, and is never put in logs, saved state or the failure reporter.
4. **Screen**: `ui/apps/AppKeysScreen.kt`, reached from `ProjectDetailScreen` by a row "App keys" with a summary ("2 of 3 set", or
   "all set"). The row shows only when the list call returns required keys. Each key row: name, "used by ...", Set / Not set chip,
   a password field with Save, and Replace / Remove (remove asks for confirmation) once set. For apps that sell things, show the
   Stripe hints ("use test keys first") and the webhook URL with a copy button, like the web panel.
5. **Nudge after a build**: when a build finishes and the app needs keys that are not set, the existing completion banner says
   "Your app needs N keys" and opens the screen. This is what prevents the dead end in the first place.
6. **Strings**: add English strings, then translate to the 19 other locale folders (the `values-*` folders next to `values`), the same way the web
   copy was translated; flag for native review.

## Secret-handling rules for this screen

- `FLAG_SECURE` on the screen's window so a pasted value cannot appear in screenshots or the recents preview (no screen uses it today).
- Password-type field, autofill and suggestions off, no show-value toggle.
- Existing safeguards are fine and stay: the HTTP logger is at HEADERS level with `Authorization` redacted, so request bodies are not
  logged, and `FailureReporterInterceptor` reports only method, path and status. The path contains the key NAME, never the value.
- Never put a value in an error message, a crash report, saved instance state or analytics.

## Tests

- View model unit tests with a fake repository, written the way `CreateViewModelTest` is. Cases: hidden on 404 and 503, retry after 502,
  save clears the draft and marks the row set, remove needs confirmation, 401 asks to sign in again, a draft survives rotation but
  never reaches saved state, busy rows cannot be double-submitted. Each guard mutation-checked.
- API contract test with MockWebServer next to `VibeBuildApiIntegrationTest`: the PUT sends `{"value": ...}` with the bearer header,
  the paths are exactly as above, and the logged request contains no body.
- Manual test on the Pixel against a throwaway app on the live proxy: set, replace, remove, confirm the proxy shows the key set and
  then gone, try a screenshot (must be blocked), kill the app mid-save, try offline.

## Release

Android release rules from this repo and memory apply: never enable minify, never declare `READ_MEDIA_*`, `LC_ALL=en_US.UTF-8` for
fastlane, bump versionCode, and ship only on the owner's go. Roll out to a small percentage first.

## Phase 2 (only after phase 1 is in use): usage and caps

`GET /api/projects/{id}/usage?days=7` returns per-feature totals, the caps and current usage. A small "Usage" card on the same
screen with a bar per feature and an upgrade button to the existing plans screen when a cap is full. The web panel's copy is the
model. Optional; keys are the part that blocks creators.

## Order and size

1. Models, repository, view model plus tests (about a day).
2. Screen, project-screen entry, completion nudge, `FLAG_SECURE` (about a day).
3. Strings in all locales, device test, release candidate (about half a day plus review).

## Open questions for the owner

1. Is the completion nudge wanted, or only the entry on the project screen?
2. Phase 2 (usage) now or later?
3. Should iOS follow immediately after Android ships?
