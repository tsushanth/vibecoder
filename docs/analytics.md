# Usage events and retention queries

VibeBuild writes first-party usage events to the `app_events` table (migration `backend/supabase/migrations/20261110000000_app_events.sql`).
There is no third-party SDK behind it. Run the queries below in the Supabase SQL editor (service role); the table has row level
security on and no policies, so the browser and the mobile apps cannot read or write it.

## What is stored

One row per event: `id`, `user_id` (the existing user id, nullable), `anon_id` (reserved, not written yet), `event`, `props`, `created_at`.

| event | written when | props |
|---|---|---|
| `signup_completed` | a new account row is created (`POST /api/auth/register`) | `source` |
| `login` | a signed-in person registers again, at most once per 30 minutes per person. The web app registers on every page load with a session, so this is the closest server-side signal to "opened the app". The Android app is not known to register on every open, so Android opens are mostly invisible. | `source` |
| `build_started` | a build was accepted (rate limits passed) | `source`, `build_kind` (`new`, `retry`), `prompt_length_bucket`, `plan_step_skipped` (true when no plan was requested in the last 30 minutes; `new` builds only) |
| `build_ready` | the worker returned a finished build | `duration_ms` (start to ready), `source`, `build_kind` |
| `build_failed` | any path that marks a build failed, including the stuck-build sweep | `error_code` (`DISPATCH_ERROR`, `WORKER_ERROR`, `NO_RESULT`, `TIMEOUT_STUCK`, `RETRY_EXHAUSTED`, `UNKNOWN`), `status` (worker HTTP status when there is one), `duration_ms`, `source`, `build_kind` |
| `tweak_started`, `tweak_ready`, `tweak_failed` | a change request to an existing app | `duration_ms`, `error_code` (`WORKER_ERROR`, `WORKER_HTTP`, `NO_RESULT`, `TIMEOUT`, `UNKNOWN`), `status`, `source`, `prompt_length_bucket` (started only) |
| `publish`, `unpublish`, `project_deleted` | the matching action succeeded | `source` |
| `rate_limited` | HTTP 429 | `cap` (`hourly_generation`, `daily_generations`, `tweaks_per_project`, `plan_hourly`, `worker_busy`, `worker_quota`), `status`, `source` |
| `paywall_or_cap_shown` | a plan-tier refusal (HTTP 403 with a required tier) on tweak, private save or fork. While everything is free this should be rare. | `cap` (`tweak_tier`, `private_tier`, `fork_tier`), `status`, `source` |
| `account_deleted` | an account was deleted. Written without `user_id`. | `source` |
| `first_build_survey` | the one-question prompt after a person's first ready build (web) | `choice` (`game_or_fun`, `personal_tool`, `work_or_business`, `learning`, `just_trying`, `something_else`, `dismissed`), `source` |

`source` is `web`, `android`, `ios` or `api` (anything else). It comes from the request's user agent or `X-Client-Platform` header.

What is never stored: prompt text, tweak text, email addresses, error messages, project ids or titles, IP addresses. The allow-list is
enforced in `backend/lib/appEvents.js` (an unknown event is dropped; every prop passes a per-key validator, so free text cannot be
stored even if a caller passes it). When an account is deleted its events are deleted too (best effort), and the `account_deleted`
row that remains carries no user id.

Limits to keep in mind when reading numbers:

- Events exist only from the day the migration and the API release went live. Cohorts from before that day have no history; the retention queries start at the first event.
- Writes are fire and forget with a 2 second timeout and a cap on pending inserts. Under a database outage events are dropped, not retried, so counts are a slight under-estimate.
- `build_started` has no project id, so a build's outcome is matched to a start by order per person (see query 2), not by id. Two builds running at once for one person can swap outcomes.
- Test and owner accounts are excluded in the queries by an email pattern, as in the retention report. Adjust the pattern if you add more.

## 0. Funnel by signup week (signed up, started a build, got a ready build, published)

```sql
with first_event as (select coalesce(min(created_at)::date, current_date) as d from app_events),
cohort as (
  select u.user_id::text as user_id, date_trunc('week', u.created_at)::date as signup_week
  from users u, first_event f
  where u.created_at::date >= f.d
    and coalesce(u.email, '') !~* 'vbtest|puzzleverseai|sushanth|kreativekoala|owner'
),
per_user as (
  select c.*,
    exists (select 1 from app_events e where e.user_id = c.user_id and e.event = 'build_started') as started,
    exists (select 1 from app_events e where e.user_id = c.user_id and e.event = 'build_ready')   as ready,
    exists (select 1 from app_events e where e.user_id = c.user_id and e.event = 'publish')       as published
  from cohort c
)
select signup_week,
       count(*)                          as signups,
       count(*) filter (where started)   as started_a_build,
       count(*) filter (where ready)     as got_a_ready_build,
       count(*) filter (where published) as published
from per_user
group by 1
order by 1;
```

## 1. D1 / D7 / D30 by signup week

Return means: any activity event on exactly day 1 / 7 / 30 after the signup day (UTC calendar days). Only people whose day N has already
passed are counted in that column's denominator. Activity is `login`, `build_started`, `tweak_started` or `publish`. Because `login` is a
web-only signal, run it twice if you want to compare platforms: once as written, once with `'login'` removed from the list (builds,
tweaks and publishes only, which both clients produce).

```sql
with first_event as (select coalesce(min(created_at)::date, current_date) as d from app_events),
cohort as (
  select u.user_id::text as user_id,
         date_trunc('week', u.created_at)::date as signup_week,
         u.created_at::date as signup_day
  from users u, first_event f
  where u.created_at::date >= f.d
    and coalesce(u.email, '') !~* 'vbtest|puzzleverseai|sushanth|kreativekoala|owner'
),
activity as (
  select distinct user_id, created_at::date as day
  from app_events
  where user_id is not null
    and event in ('login', 'build_started', 'tweak_started', 'publish')   -- drop 'login' for a cross-platform view
),
per_user as (
  select c.*,
    exists (select 1 from activity a where a.user_id = c.user_id and a.day = c.signup_day + 1)  as d1,
    exists (select 1 from activity a where a.user_id = c.user_id and a.day = c.signup_day + 7)  as d7,
    exists (select 1 from activity a where a.user_id = c.user_id and a.day = c.signup_day + 30) as d30
  from cohort c
)
select signup_week,
       count(*) as signups,
       count(*) filter (where signup_day + 1 <= current_date)  as d1_eligible,
       count(*) filter (where d1)                              as d1_back,
       round(100.0 * count(*) filter (where d1)  / nullif(count(*) filter (where signup_day + 1  <= current_date), 0), 1) as d1_pct,
       count(*) filter (where signup_day + 7 <= current_date)  as d7_eligible,
       count(*) filter (where d7)                              as d7_back,
       round(100.0 * count(*) filter (where d7)  / nullif(count(*) filter (where signup_day + 7  <= current_date), 0), 1) as d7_pct,
       count(*) filter (where signup_day + 30 <= current_date) as d30_eligible,
       count(*) filter (where d30)                             as d30_back,
       round(100.0 * count(*) filter (where d30) / nullif(count(*) filter (where signup_day + 30 <= current_date), 0), 1) as d30_pct
from per_user
group by 1
order by 1;
```

## 2. First-build outcome vs return

For each person: their first `build_started`, then the first `build_ready` or `build_failed` at or after it (`no_outcome` when neither
arrived, for example the build is still running, was abandoned, or the event was dropped). Returned = any activity event on a later UTC
calendar day within 7 days of the first-build day. Only people who signed up after events began (so the first build seen really is their first) and whose 7 days have passed are counted. Change `7` for another window.

```sql
with first_build as (
  select user_id, min(created_at) as started_at
  from app_events
  where event = 'build_started' and user_id is not null
  group by 1
),
outcome as (
  select f.user_id, f.started_at,
         coalesce((
           select e.event from app_events e
           where e.user_id = f.user_id and e.event in ('build_ready', 'build_failed') and e.created_at >= f.started_at
           order by e.created_at limit 1
         ), 'no_outcome') as first_outcome
  from first_build f
  where exists (   -- people who signed up after events began (their first build is then really their first), minus test accounts
    select 1 from users u
    where u.user_id::text = f.user_id
      and u.created_at >= (select min(created_at) from app_events)
      and coalesce(u.email, '') !~* 'vbtest|puzzleverseai|sushanth|kreativekoala|owner'
  )
),
activity as (
  select distinct user_id, created_at::date as day
  from app_events
  where user_id is not null and event in ('login', 'build_started', 'tweak_started', 'publish')
)
select o.first_outcome,
       count(*) as people,
       count(*) filter (where exists (
         select 1 from activity a
         where a.user_id = o.user_id and a.day > o.started_at::date and a.day <= o.started_at::date + 7
       )) as returned_within_7d,
       round(100.0 * count(*) filter (where exists (
         select 1 from activity a
         where a.user_id = o.user_id and a.day > o.started_at::date and a.day <= o.started_at::date + 7
       )) / count(*), 1) as pct_returned
from outcome o
where o.started_at::date + 7 <= current_date
group by 1
order by 2 desc;
```

## 3. Build duration percentiles

Start to ready, in seconds. By week and by source; the same for failed builds is the second query (how long people waited before the failure).

```sql
select date_trunc('week', created_at)::date as week,
       props->>'source' as source,
       count(*) as builds,
       round((percentile_cont(0.5)  within group (order by (props->>'duration_ms')::numeric) / 1000)::numeric, 1) as p50_s,
       round((percentile_cont(0.9)  within group (order by (props->>'duration_ms')::numeric) / 1000)::numeric, 1) as p90_s,
       round((percentile_cont(0.95) within group (order by (props->>'duration_ms')::numeric) / 1000)::numeric, 1) as p95_s,
       round((max((props->>'duration_ms')::numeric) / 1000)::numeric, 1) as max_s
from app_events
where event = 'build_ready' and props ? 'duration_ms'
group by 1, 2
order by 1, 2;
```

```sql
select date_trunc('week', created_at)::date as week,
       props->>'error_code' as error_code,
       count(*) as failed,
       round((percentile_cont(0.5) within group (order by (props->>'duration_ms')::numeric) / 1000)::numeric, 1) as median_wait_s
from app_events
where event = 'build_failed' and props ? 'duration_ms'
group by 1, 2
order by 1, 3 desc;
```

## 4. Error code breakdown (and the failure rate)

```sql
select date_trunc('week', created_at)::date as week,
       props->>'error_code' as error_code,
       props->>'status'     as worker_http_status,
       props->>'source'     as source,
       count(*)             as failures,
       count(distinct user_id) as people
from app_events
where event = 'build_failed'
group by 1, 2, 3, 4
order by 1 desc, 5 desc;
```

```sql
-- Failure rate and how often people hit a limit, by week
select date_trunc('week', created_at)::date as week,
       count(*) filter (where event = 'build_started') as started,
       count(*) filter (where event = 'build_ready')   as ready,
       count(*) filter (where event = 'build_failed')  as failed,
       round(100.0 * count(*) filter (where event = 'build_failed')
             / nullif(count(*) filter (where event in ('build_ready', 'build_failed')), 0), 1) as failed_pct,
       count(*) filter (where event = 'rate_limited')  as rate_limited,
       count(*) filter (where event = 'paywall_or_cap_shown') as plan_gate_shown
from app_events
group by 1
order by 1 desc;
```

```sql
-- Which limit was hit
select props->>'cap' as cap, event, count(*) as times, count(distinct user_id) as people
from app_events
where event in ('rate_limited', 'paywall_or_cap_shown')
group by 1, 2
order by 3 desc;
```

## 5. First-build survey: choice distribution

`dismissed` means the person closed the prompt without answering. The response rate compares answers with people who got a first ready build
(web only, since only the web app asks; Android builds are in the denominator unless you filter on `source`).

```sql
select props->>'choice' as choice,
       count(*) as people,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_of_responses
from app_events
where event = 'first_build_survey'
group by 1
order by 2 desc;
```

```sql
select count(*) filter (where choice is not null and choice <> 'dismissed') as answered,
       count(*) filter (where choice = 'dismissed')                          as dismissed,
       count(*)                                                              as ready_web_builders,
       round(100.0 * count(*) filter (where choice is not null) / nullif(count(*), 0), 1) as asked_and_handled_pct
from (
  select r.user_id, s.props->>'choice' as choice
  from (select distinct user_id from app_events where event = 'build_ready' and props->>'source' = 'web') r
  left join app_events s on s.user_id = r.user_id and s.event = 'first_build_survey'
) t;
```

## Housekeeping

- Rollback of the table: `drop table if exists app_events;` (the API keeps working; it backs off for a minute and warns once).
- To stop writing without a release: set the Fly secret `APP_EVENTS_ENABLED=false` on `vibecoder-api`.
- The Replitor database is shared with another product; the migration only creates `app_events`.
