-- Webhook event log for the Stripe and RevenueCat webhooks: de-duplication (primary key) and out-of-order detection
-- (newest event_created per subject). Additive only; the backend works without it (it fails soft and reports once).
-- The Replitor project is shared with SimplyApply, so the table name is VibeBuild-specific. Not applied by the PR.
create table if not exists vibebuild_billing_events (
    source        text not null,                    -- 'stripe' | 'revenuecat'
    event_id      text not null,                    -- Stripe evt_... / RevenueCat event.id
    subject       text,                             -- Stripe subscription id, or the VibeBuild user id for RevenueCat
    event_type    text,
    event_created timestamptz,                      -- when the provider says the event happened
    outcome       text not null default 'applied',  -- applied | skipped | stale | duplicate-free text
    processed_at  timestamptz not null default now(),
    primary key (source, event_id)
);

create index if not exists vibebuild_billing_events_subject_idx
    on vibebuild_billing_events (source, subject, event_created desc);

-- Server-side only (the backend uses the service role, which bypasses RLS). No policies = no access for anon/authenticated.
alter table vibebuild_billing_events enable row level security;
