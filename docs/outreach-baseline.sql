-- VibeBuild: signups after an email send vs a 14-day baseline. Read-only (Supabase SQL editor, service role).
-- Use it when link attribution is not available (the announcement went out without utm links): compares new accounts in the
-- N days after the send with the N days before it. A lift is a hint, not proof: other channels move at the same time.
-- Real accounts only (a row with an email); anonymous device ids are excluded. Change the values in `params`.
-- Past send: 2026-11-01 (announcement lift).
with params as (
  select timestamptz '2026-11-01 17:00:00+00' as send_at,   -- when the campaign went out (UTC; take it from the sender log or outreach_events in the Calldesk project)
         14                                   as days        -- window length on each side
), windows as (
  select 'before' as w, send_at - make_interval(days => days) as lo, send_at as hi, days from params
  union all
  select 'after',       send_at,                              send_at + make_interval(days => days),     days from params
), counted as (
  select w.w, w.days, count(u.user_id) as signups
  from windows w
  left join public.users u on u.email is not null and u.created_at >= w.lo and u.created_at < w.hi
  group by w.w, w.days
)
select b.signups                                                            as signups_before,
       a.signups                                                            as signups_after,
       round(b.signups::numeric / b.days, 2)                                as per_day_before,
       round(a.signups::numeric / a.days, 2)                                as per_day_after,
       round(a.signups::numeric / nullif(b.signups, 0), 2)                  as lift_after_over_before
from counted b join counted a on a.w = 'after' where b.w = 'before';

-- Link-attributed signups per campaign (users.utm_* is filled when the web app sends signup_source; needs migration 20261101000000).
-- select utm_campaign, count(*) as signups from public.users where utm_source = 'outreach' group by 1 order by 2 desc;
-- Of those, who built a first project (what the activated event reports):
-- select u.utm_campaign, count(distinct u.user_id) as signups, count(distinct p.creator_id) as built_a_project
--   from public.users u left join public.projects p on p.creator_id = u.user_id
--  where u.utm_source = 'outreach' group by 1 order by 2 desc;
