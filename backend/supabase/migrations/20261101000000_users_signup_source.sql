-- First-touch signup attribution on public.users (VibeBuild table; the Replitor database is shared with SimplyApply).
-- Additive and nullable: no drops, no defaults, no backfill, so it does not rewrite the table and is safe to run at any
-- time relative to the code deploy. The backend (lib/signupSource.js) writes these columns in a separate best-effort update
-- and skips quietly while they do not exist, so either order works.
--
--   platform          web | android | ios | unknown (from the X-Client-Platform header or the user agent)
--   utm_*             campaign tags captured on the visitor's first visit, each at most 64 characters
--   referrer_host     host name of the first external referrer (no path, no query)
--   landing_path      path of the first page visited (no query string)
--   signup_source_at  when the source was recorded; the writer only fills rows where this is still null
alter table public.users
    add column if not exists platform text,
    add column if not exists utm_source text,
    add column if not exists utm_medium text,
    add column if not exists utm_campaign text,
    add column if not exists utm_content text,
    add column if not exists referrer_host text,
    add column if not exists landing_path text,
    add column if not exists signup_source_at timestamptz;

-- Admin read-only query: signups by week by source (run after the migration; accounts created before it show as 'unattributed').
--
--   select date_trunc('week', created_at)::date                     as week,
--          coalesce(platform, 'unattributed')                      as platform,
--          coalesce(utm_source, referrer_host, '(direct)')         as source,
--          count(*)                                                as signups
--   from public.users
--   where created_at >= now() - interval '12 weeks'
--   group by 1, 2, 3
--   order by 1 desc, 4 desc;
