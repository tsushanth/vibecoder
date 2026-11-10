-- First-party usage events: build/publish/error milestones, so retention and failure causes can be measured.
-- Written only by the API (service role). Columns hold ids and short allow-listed codes, never prompt text, emails or free text.
-- Additive and idempotent. The API works without it (it fails soft, backs off for a minute and warns once).
-- The Replitor project is shared with SimplyApply, so nothing here touches any other table.
-- Rollback: drop table if exists app_events;
create table if not exists app_events (
    id         uuid primary key default gen_random_uuid(),
    user_id    text,                                   -- the existing VibeBuild user id (Supabase auth id, or an anonymous device id); null for events that must not name a person
    anon_id    text,                                   -- reserved for pre-signup visitors; not written yet
    event      text not null,                          -- one of the names allow-listed in backend/lib/appEvents.js
    props      jsonb not null default '{}'::jsonb,     -- allow-listed keys only: duration_ms, status, error_code, source, plan_step_skipped, prompt_length_bucket, build_kind, cap, choice
    created_at timestamptz not null default now(),
    constraint app_events_props_is_object check (jsonb_typeof(props) = 'object')
);

create index if not exists app_events_event_created_idx on app_events (event, created_at desc);
create index if not exists app_events_user_created_idx  on app_events (user_id, created_at desc);

-- The first-build question is asked once per person: the second insert fails and the API treats that as "already answered".
create unique index if not exists app_events_survey_once on app_events (user_id) where event = 'first_build_survey';

-- Server-side only (the API uses the service role, which bypasses RLS). No policies = no access for anon/authenticated,
-- and the default table grants are removed as well.
alter table app_events enable row level security;
revoke all on table app_events from anon, authenticated;
