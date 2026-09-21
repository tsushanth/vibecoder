# Worker prompt addition: persistent app data (vibedata)

For the lead to wire into `worker/server.js` (not done by this change).

## 1. Worker changes required (blockers, not just prompt text)

1. **Validator conflicts.** `worker/server.js` (~line 690-715) flags any external URL and `fetch("https://...")`
   as *critical* ("All resources must be local", "App must work offline"). Both the SDK `<script src>` and any
   direct API call would be rejected. Recommended: **inline the SDK** (copy `backend/public/vibedata.js` into
   each generated project as `vibedata.js` and reference it as `<script src="vibedata.js">`), and whitelist the
   string `vibecoder-api.fly.dev/api/appdata` in the URL check (it lives inside the SDK file, so exempt `vibedata.js`
   from the external-URL scan). Also drop/relax the "must work offline" wording for apps that use vibedata.
2. **Copy the SDK into every project dir** at generation time so it ships in the bundle.
3. **Data only works on the published origin** (`https://<subdomain>.vibebuild.cc` or a verified custom domain).
   Previews (`/p/<subdomain>/` path URLs, WebViews, file://) are rejected by the API (403). The SDK rejects,
   so the prompt below requires a localStorage fallback.

## 2. Suggested prompt text (append near "Use localStorage to persist user data", ~line 335 / 1031)

```
## Shared / persistent data (optional)
Some apps need data that survives across devices and users (guestbooks, leaderboards, polls, shared todo
lists, sign-ups). The file `vibedata.js` is already in the project. Include it with
`<script src="vibedata.js"></script>` BEFORE your own script. It defines `window.vibedata`, all promise-based:

  await vibedata.get(collection, key)              // value, or null if missing
  await vibedata.set(collection, key, value)       // value = any JSON, max 32KB
  await vibedata.remove(collection, key)
  const { items, next } = await vibedata.list(collection, { prefix, limit, after })
      // items = [{ key, value, updatedAt }], limit <= 100, pass `after: next` to page

Rules:
- collection: letters, digits, _ or - (max 64). key: letters, digits, . _ : - (max 128).
- Limits per app: 1000 keys, 5MB total. Handle rejected promises (err.status 413 quota, 429 rate limit,
  503 unavailable, 403 when previewing) by showing a friendly message.
- ALWAYS keep working when vibedata fails: wrap calls in try/catch and fall back to localStorage so the app
  is usable in preview. Never block first render on a network call.
- Store one small record per key (e.g. key = a generated id like Date.now()+'-'+Math.random().toString(36).slice(2,8)),
  not one giant array under a single key (concurrent users would overwrite each other).
- Anyone who can open the app can read AND write this data. Never store secrets, passwords, or private
  personal data. There is no per-user auth; do not build features that depend on trusting client-sent identity.
- Use it only when shared/persistent data is actually needed; single-user state stays in localStorage.
- Do not call any other network API.
```
