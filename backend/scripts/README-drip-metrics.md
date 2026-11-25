# Drip sender and the outreach metrics layer

`send-promo.ts` is wired to the shared outreach metrics layer (Calldesk `docs/OUTREACH-METRICS.md`).

Always on: every send carries Resend tags `campaign_id` (`vibebuild-promoN-<yyyymm01>`) and `product`; every accepted send is written to a
local ledger (`~/.outreach-ledger/vibebuild.jsonl`, hashes only), and touch 1 skips anyone this product mailed in the last 90 days.

Behind `OUTREACH_METRICS=1` (default off; set it in the environment of whatever runs the script, with `CRON_SECRET` and
`OUTREACH_EVENT_SECRET`): campaign registration, the layer's dedupe, the bounce circuit breaker (`pause_recommended` stops the batch)
and `sent` events. Every layer call is fail-open with a 3 s timeout; the drip never rewrites links. Turn it on only after
`https://calldesk.tech/api/outreach/check` is verified live; turn it off by unsetting the variable.

`lib/outreach-metrics.mjs` is a verbatim copy of `harness/lib/outreach-metrics/outreach-metrics.mjs` in the ops repo; do not edit it here.
