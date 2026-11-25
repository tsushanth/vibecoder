# Outreach attribution (VibeBuild backend)

Reports signups and the first activation of people who arrived through an outreach email link to the shared outreach metrics layer
(Calldesk `docs/OUTREACH-METRICS.md`, `POST /api/outreach/event`). Code: `backend/lib/outreachEvents.js`,
`backend/lib/outreachEventsInstance.js`, hooks in `backend/routes/auth.routes.js` and `backend/routes/projects.routes.js`.

## What is reported
- `signup`: `POST /api/auth/register` for a verified sign-in that creates the users row, when the `signup_source` the web app already
  sends has `utm_source=outreach` and a valid `utm_campaign` (`utm_content` becomes `link_code`). Same `signup_source` that fills
  `users.utm_*` (migration 20261101000000). Anonymous device rows are never reported.
- `activated`: the first project created (`/generate` placeholder, `/generate` fallback insert, `/save`), only for users whose
  `users.utm_source` is `outreach` and who had no earlier project. At most one lookup per user per process; the layer keeps one row per
  user and campaign.
- The email goes only in the signed body; the layer hashes it with its pepper and never stores it. Logs carry event, campaign and status.

## Off by default
Nothing runs unless `OUTREACH_EVENTS_URL` (https) and a secret (`OUTREACH_EVENT_SECRET_VIBEBUILD`, else `OUTREACH_EVENT_SECRET`) are set.
Fire and forget, 2 s timeout, one background retry on network error / 5xx / 429, all errors swallowed.

## Enable (after the Calldesk layer is verified live)
```
flyctl secrets set -a vibecoder-api OUTREACH_EVENT_SECRET=<same value as calldesk-tech> OUTREACH_EVENTS_URL=https://calldesk.tech/api/outreach/event
```
Announcement links must be the layer's `/o/<campaign>/<code>` redirects, which add the utm params to the web landing page.

## Without link attribution
`docs/outreach-baseline.sql`: signups in the 14 days after a send vs the 14 days before.
