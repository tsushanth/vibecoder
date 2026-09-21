# Proposal: integrations for generated apps (payments, email, AI) - GAP #6

Status: proposal only. Nothing implemented. Involves money and secrets, so it needs user decisions.

## Constraint
Generated apps are public static sites. Any key placed in their JS is public (repo rule: never ship paid
LLM keys client-side). So every integration must be a **VibeBuild-hosted proxy** that holds the real secret,
and apps call it with something weaker and revocable.

## Design
- `POST /api/integrations/:appId/<capability>` on `vibecoder-api`, same Origin-gating as `/api/appdata`
  (origin must equal the app's published origin), plus a **per-app scoped token** issued at deploy time
  (stored hashed in a table `app_integrations(app_id, token_hash, enabled caps, quotas, created_at, revoked_at)`).
  Caveat: the token is embedded in public JS, so it is only an identifier that lets us revoke/meter one app -
  it is not a secret. Real protection = quotas + allowlisted operations + kill switch.
- Owner controls in the VibeBuild app: enable capability, see usage, revoke token, set caps.
- Metering table per app per day; hard caps checked atomically (as `app_data_put` does); global circuit breaker.

## What to offer first (lowest risk to highest)
1. **Email (form-to-owner only)**: app can send "contact form" messages to the *app owner's verified email*
   only (recipient never client-controlled). No arbitrary recipients => no spam relay. Cap e.g. 20/day/app.
2. **AI text** (Anthropic via our proxy): fixed model, max_tokens cap, per-app daily token budget, per-IP limit,
   optional system prompt fixed server-side. Highest abuse/cost risk; needs a budget owner.
3. **Payments**: offer only *Stripe Payment Links / Checkout* configured by the owner with their own Stripe
   account (Connect or pasted restricted link). App just renders a link/button; no server-side payment
   proxy needed at first. Anything holding funds or creating charges on our account is a large step (KYC,
   refunds, chargebacks, liability, sales tax).

## Abuse and cost risks
- Public endpoint + public token: bots can drain AI/email budgets. Mitigate: daily per-app and global caps,
  per-IP limits, Turnstile on high-cost calls, auto-disable on spike.
- Email: spam relay, sender-domain reputation damage (SPF/DKIM shared domain). Owner-only recipient mitigates.
- AI: prompt-injection/abuse to generate harmful content under our brand; needs content policy + logging.
- Payments: fraud, card testing, disputes, using VibeBuild as a payment facilitator (regulatory).
- Data/PII: apps collecting emails or payments raises privacy-policy obligations (note: policy drafts already
  need legal review).
- Same-Origin gating stops other websites, not scripts; do not treat as auth.

## Decisions the user must make
1. Which capability first: email-to-owner, AI, payment links? (Recommendation: email-to-owner, then AI.)
2. Who pays for AI/email usage: absorbed in plan price, metered against coins/credits, or per-plan caps?
   Exact free/paid daily caps per app.
3. Email provider and sending domain (shared `vibebuild.cc` vs owner's domain); who is the "from".
4. Payments model: owner-supplied Stripe links only (no liability) vs Stripe Connect (VibeBuild as platform,
   takes fee, compliance burden). Related to the 20% partner revenue share: is a platform fee wanted?
5. Which LLM/model and budget ceiling; approve a new recurring paid job (needs explicit go-ahead).
6. New secrets needed (email API key, etc.): confirm values and that they are added to Fly by the user.
7. Abuse policy: auto-suspend thresholds, and whether to require verified account/email to enable integrations.
8. Whether generated apps may call integrations from previews, or published origin only (recommended).

## Dependency on app data
Reuses appdata's origin resolver, rate limiter and per-app quota pattern (`backend/routes/appdata.routes.js`).
Usage metering can live in the same Supabase project.
