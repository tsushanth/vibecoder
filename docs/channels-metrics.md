# Channel metrics (Telegram first)

Until now there were no numbers for the chat channels. Two things record them:

* **`channel_events`**: one row per bot interaction. Columns: `channel` (`telegram`; `sms` and `whatsapp` are allowed for later), `event`, `language`, `chat_ref` (keyed hash of the chat id, distinct-countable, not reversible without the key), `user_id` (the account the action ran as: a real user id or `tg_<id>`), `project_id`, `props` (allow-listed keys only: `command`, `start_payload`, `cap`, `error_code`, `duration_ms`, `prompt_length_bucket`, `linked`, `from_language`, `new_chat`, `idea_index`). Never message text, names or prompts.
* **`projects.source_channel`**: where a project was created: `android`, `ios`, `web`, `telegram`, `sms`, `whatsapp`, `api`. Set for new builds from `POST /api/projects/generate` (the chat bots name their channel in `source`, the Android app sends `x-platform: android`, web is recognised by user agent). Older projects are null.
* Build events also land in the existing `app_events` table with `props.source = 'telegram'`.

Events: `update_received`, `start`, `build_queued`, `build_finished`, `build_failed`, `build_stopped`, `link_started`, `link_done`, `link_failed`, `language_changed`, `idea_picked`, `apps_listed`, `rate_limited`, `help`, `unsupported_message`.

Both need the migration `backend/supabase/migrations/20261122000000_telegram_channel.sql`. Until it is applied the API logs one warning and skips the writes; nothing else is affected. `CHANNEL_EVENTS_ENABLED=false` turns recording off.

## Quick look (no SQL)

```
curl -s -H "x-worker-secret: $WORKER_SECRET" "https://vibecoder-api.fly.dev/api/telegram/stats?days=7"
```

Returns `{ totals, byLanguage, startsByPayload, distinctChats, events }` for the window (worker secret required, 503 if the table is missing).

## SQL (Supabase SQL editor, read only)

Daily funnel, last 14 days:

```sql
select date_trunc('day', created_at)::date                                  as day,
       count(distinct chat_ref)                                             as chats,
       count(*) filter (where event = 'start')                              as starts,
       count(*) filter (where event = 'build_queued')                       as builds_queued,
       count(*) filter (where event = 'build_finished')                     as builds_finished,
       count(*) filter (where event = 'build_failed')                       as builds_failed,
       count(*) filter (where event = 'link_done')                          as links_done,
       count(*) filter (where event = 'rate_limited')                       as rate_limited
from channel_events
where channel = 'telegram' and created_at >= now() - interval '14 days'
group by 1 order by 1 desc;
```

By language (where the product is actually used):

```sql
select coalesce(language, 'unknown') as language,
       count(distinct chat_ref) as chats,
       count(*) filter (where event = 'build_queued')   as queued,
       count(*) filter (where event = 'build_finished') as finished,
       count(*) filter (where event = 'build_failed')   as failed
from channel_events
where channel = 'telegram' and created_at >= now() - interval '30 days'
group by 1 order by queued desc, chats desc;
```

Install-to-bot attribution (which surface sent people; `app` is the Android banner, `app_card` the Create card, `app_build` the post-build button, `app_settings` the Account row, `web_home` / `web` the website, `link` a link deep link):

```sql
select coalesce(props->>'start_payload', 'none') as payload,
       count(*)                                    as starts,
       count(distinct chat_ref)                    as chats,
       count(*) filter (where (props->>'new_chat')::boolean) as new_chats
from channel_events
where channel = 'telegram' and event = 'start' and created_at >= now() - interval '30 days'
group by 1 order by starts desc;
```

Conversion per chat (start -> first build -> finished build):

```sql
with per_chat as (
  select chat_ref,
         bool_or(event = 'start')          as started,
         bool_or(event = 'build_queued')   as queued,
         bool_or(event = 'build_finished') as finished,
         bool_or(event = 'link_done')      as linked
  from channel_events where channel = 'telegram' and created_at >= now() - interval '30 days' and chat_ref is not null
  group by 1)
select count(*) as chats, count(*) filter (where started) as started, count(*) filter (where queued) as built,
       count(*) filter (where finished) as got_an_app, count(*) filter (where linked) as linked
from per_chat;
```

Build time and failure reasons:

```sql
select percentile_cont(0.5) within group (order by (props->>'duration_ms')::int) / 1000 as median_seconds,
       count(*) as finished
from channel_events where channel = 'telegram' and event = 'build_finished' and created_at >= now() - interval '30 days';

select coalesce(props->>'error_code', 'UNKNOWN') as reason, count(*) from channel_events
where channel = 'telegram' and event = 'build_failed' and created_at >= now() - interval '30 days' group by 1 order by 2 desc;
```

Projects by channel (all apps, the answer to "where do builds come from"):

```sql
select coalesce(source_channel, 'unknown') as channel, count(*) as projects,
       count(*) filter (where status = 'ready') as ready
from projects where created_at >= now() - interval '30 days'
group by 1 order by projects desc;
```

## Housekeeping

`telegram_updates` (de-duplication) is pruned by the bot every few hours (rows older than 3 days). `channel_events` rows are small; if wanted, `delete from channel_events where created_at < now() - interval '400 days';`. An account deletion removes that user's `channel_events` rows.
