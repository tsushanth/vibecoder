# vibe.js worker integration (slice 1, step 5)

Date: 2026-10-05. Status: built and tested locally on branch `tier1-worker-vibe`; not pushed, not deployed. The platform proxy it talks to is not deployed either.

## What it does

When `VIBE_PROXY_ENABLED=true` (exactly that string; anything else is off) the direct-generation worker:
1. adds a "Live data and AI without API keys (vibe.js)" section to the system prompt (`lib/vibe.js`, `VIBE_RULES`), which says it overrides the no-external-APIs rule for `vibe.api` and `vibe.ai` only;
2. checks each generated app: if it uses `vibe.api` or `vibe.ai` it must load `<script src="vibe.js">`, must name only known connectors (currently `nws`) with a string literal, and is run in the headless-browser check with the real SDK injected so an unguarded SDK call that fails is reported to the fix pass;
3. delivers the real `assets/vibe.js` with the app and never a model-written one (`parseFiles` ignores `vibe.js` blocks, `injectSdk` replaces or removes any other copy);
4. exempts `vibe.js` from the external-dependency check only when byte-identical to `assets/vibe.js`; the proxy host written anywhere else is still an external fetch.

When the flag is off (the default) nothing is added to the prompt, no SDK is delivered, and an app that uses `vibe.api` or `vibe.ai` is rejected by the check so the fix pass removes it. `/health` reports `vibe: { enabled }`.

## Why a flag

The proxy does not exist yet. Telling models to call it would ship apps that fail at run time. Turn the flag on only after the proxy is deployed, reachable, and `assets/vibe.js` points at its real URL.

## Known limits (verified by reading the code or tests, not by running against a live proxy)

- `assets/vibe.js` is a copy of `platform/sdk/vibe.js` from the unmerged `tier1-slice1` branch. Its default base URL `https://vibe-proxy.vibebuild.cc` is a PLACEHOLDER. There is no sync test against the platform copy yet because that directory is not on `main`; add one when `platform/` is merged.
- `KNOWN_CONNECTORS` in `lib/vibe.js` duplicates the proxy's built-in list (`nws` only). Keep them in sync by hand until `platform/` is on `main`.
- Only the NWS (US weather) connector and `vibe.ai` exist. Creator-keyed connectors need the manifest and secure key entry (slice 1 step 6) and are not part of this.
- No test has used a real model: model behavior with the new prompt section (do models use the SDK correctly, do they invent connectors) is untested and needs the OpenRouter key topped up. The tests use a fake provider and a real headless Chrome.
- The existing shipped prompt also says to submit game scores to `https://puzzleverseai.com/api/leaderboard/...`, while the external-dependency check rejects any external fetch. That conflict predates this work and is unchanged; it may cost fix passes on games.
- In the browser check, Chrome already reports unhandled promise rejections as page errors (this is true of the existing runtime check, not only vibe). Apps with an unguarded `audio.play()` can be flagged. Unchanged.
