-- Visit counts for published apps, and one app_open usage event per person per day. Additive and idempotent.
-- The Replitor project is shared with SimplyApply: the new table and functions are VibeBuild-specific.
-- No visitor data is stored: one number per published app per UTC day.
-- Rollback: backend/supabase/rollback/20261126000000_app_visits_and_app_open.down.sql

create table if not exists public.vibebuild_app_visits (
    project_id uuid    not null references public.projects(id) on delete cascade,
    day        date    not null,
    visits     integer not null default 0 check (visits >= 0),
    primary key (project_id, day)
);
-- Server-side only (service role bypasses RLS). No policies = no access for anon/authenticated.
alter table public.vibebuild_app_visits enable row level security;
revoke all on table public.vibebuild_app_visits from anon, authenticated;

-- Adds one visit to the published app at this subdomain. False when no active deployment has that name (previews, removed apps).
create or replace function public.vibebuild_record_app_visit(p_subdomain text)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
begin
    insert into public.vibebuild_app_visits as v (project_id, day, visits)
    select d.project_id, (now() at time zone 'utc')::date, 1
      from public.deployments d
     where d.subdomain = p_subdomain and d.status = 'active' and d.project_id is not null
     limit 1
    on conflict (project_id, day) do update set visits = v.visits + 1;
    return found;
end;
$$;

-- One row per published app of this creator, newest deployment name first.
create or replace function public.vibebuild_creator_visits(p_user text)
returns table (project_id uuid, subdomain text, today bigint, last_7_days bigint, last_30_days bigint, total bigint)
language sql
stable
set search_path = public, pg_temp
as $$
    select p.id,
           d.subdomain::text,
           coalesce(sum(v.visits) filter (where v.day = (now() at time zone 'utc')::date), 0),
           coalesce(sum(v.visits) filter (where v.day > (now() at time zone 'utc')::date - 7), 0),
           coalesce(sum(v.visits) filter (where v.day > (now() at time zone 'utc')::date - 30), 0),
           coalesce(sum(v.visits), 0)
      from public.projects p
      join lateral (select x.subdomain from public.deployments x
                     where x.project_id = p.id and x.status = 'active'
                     order by x.deployed_at desc nulls last limit 1) d on true
      left join public.vibebuild_app_visits v on v.project_id = p.id
     where p.creator_id = p_user
     group by p.id, d.subdomain;
$$;

revoke all on function public.vibebuild_record_app_visit(text) from public, anon, authenticated;
revoke all on function public.vibebuild_creator_visits(text) from public, anon, authenticated;
grant execute on function public.vibebuild_record_app_visit(text) to service_role;
grant execute on function public.vibebuild_creator_visits(text) to service_role;

create unique index if not exists app_events_app_open_daily
    on public.app_events (user_id, (((created_at at time zone 'utc'))::date))
    where event = 'app_open';
