# Channel metrics (Telegram first)

Until now there were no numbers for the chat channels. Two things record them:

* **`channel_events`**: one row per bot interaction. Columns: `channel` (`telegram`; `sms` and `whatsapp` are allowed for later), `event`, `language`, `chat_ref` (keyed hash of the chat id, distinct-countable, not reversible without the key), `user_id` (the account the action ran as: a real user id or `tg_<id>`), `project_id`, `props` (allow-listed keys only: `command`, `start_payload`, `cap`, `error_code`, `duration_ms`, `prompt_length_bucket`, `linked`, `from_language`, `new_chat`, `idea_index`). Never message text, names or prompts.
* **`projects.source_channel`**: where a project was created: `android`, `ios`, `web`, `telegram`, `sms`, `whatsapp`, `api`. Set for new builds from `POST /api/projects/generate` (the chat bots name their channel in `source`, the Android app sends `x-platform: android`, web is recognised by user agent). Older projects are null.
* Build events also land in the existing `app_events` table with `props.source = 'telegram'`.

Events: `update_received`, `start`, `build_queued`, `build_finished`, `build_failed`, `build_stopped`, `link_started`, `link_done`, `link_failed`, `language_changed`, `idea_picked`, `apps_listed`, `rate_limited`, `help`, `unsupported_message`, `bot_blocked`, `bot_unblocked`, `bot_error`.

* `/stop` and `/help` are `update_received` with `props.command` = `stop` / `help` (and `build_stopped` / `help` when they did something). Every slash command and every plain message is one `update_received`, so activity per chat is `update_received`.
* `bot_blocked` / `bot_unblocked`: the person blocked or unblocked the bot (Telegram `my_chat_member` update, private chats). Telegram only sends these when the webhook's `allowed_updates` includes `my_chat_member`: the setup script and the command in `docs/channels.md` now do, but the webhook must be set again once for it to take effect (`setWebhook` replaces the list). Until then these two events do not appear.
* `bot_error`: an update failed inside the bot (`props.error_code` = `HANDLER`); the chat is not told. `rate_limited` carries which cap (`props.cap`: `chat_flood`, `anon_daily`, `anon_global_daily`, `hourly_chat`, `active_build`, `global_active`, `server_429`); `anon_daily` and `anon_global_daily` are the "not linked yet" caps.
* Start payloads (`props.start_payload`) are `app` (Android banner), `app_card` (Create card), `app_build` (post-build button), `app_settings` (Account row), `web_home` (website home), `web_connect` (the /connect page), `web` (older website links), `link` (account-link deep link), `none`, `other`. Before this change `web_home` and `web_connect` were stored as `other`; those earlier rows cannot be recovered.

### Promotion in the app and on the web

The surfaces that send people to the bot are now measured on their own side too:

| surface | where | impression | tap | bot start payload |
|---|---|---|---|---|
| `banner` | Android, top of the main screen (comes back after 7 days) | `app_events.promo_impression` | `promo_tap` (and `promo_dismiss`) | `app` |
| `create_card` | Android, Create screen, under the prompt box | `promo_impression` | `promo_tap` | `app_card` |
| `post_build` | Android, "Continue on Telegram" after a build | `promo_impression` | `promo_tap` | `app_build` |
| `account_row` | Android, Account screen row | `promo_impression` | `promo_tap` | `app_settings` |
| `web_home` | website home, "Build from Telegram" block | Gaugemint custom event `Telegram Section View` (prop `surface`) | Gaugemint `Telegram Click` (prop `surface`) | `web_home` |
| `web_connect` | website `/connect` (the page with no account state) | Gaugemint page views of `/connect` | Gaugemint `Telegram Click` (prop `surface`) | `web_connect` |

* App events are rows in `app_events` (`event` = `promo_impression` | `promo_tap` | `promo_dismiss`, `user_id` = the signed-in account, `props` = `{ surface, lang, source }`, nothing else). They are written by `POST /api/events/promo` for signed-in callers only, at most 30 a minute per person. An impression is counted once per surface per app launch (post-build: once per finished build). They need the Android release after 2.7.2 (78); older versions send nothing.
* A tap cannot be matched to the chat it opens (Telegram gives the bot a payload, not the account), so the funnel is joined by SURFACE: taps of a surface are compared with the chats whose first `/start` carried its payload. Only linked accounts can be followed per person (query 4).
* Web events go to Gaugemint, not to the database (the website has no sender of its own). The tag honours Do Not Track and Global Privacy Control, so web numbers are a floor. Which goals/props Gaugemint shows depends on its setup (register `Telegram Click` and `Telegram Section View` as goals and `surface` as a property if its dashboard asks); this was not checked against the live Gaugemint.

Both need the migration `backend/supabase/migrations/20261122000000_telegram_channel.sql`. Until it is applied the API logs one warning and skips the writes; nothing else is affected. `CHANNEL_EVENTS_ENABLED=false` turns recording off.

## Quick look (no SQL)

```
curl -s -H "x-worker-secret: $WORKER_SECRET" "https://vibecoder-api.fly.dev/api/telegram/stats?days=7"
```

Returns `{ totals, byLanguage, startsByPayload, distinctChats, events, promotion }` for the window (worker secret required, 503 if the table is missing). `promotion` is the funnel below per surface: `surfaces.<surface>` = `{ impressions, impressionUsers, taps, tapUsers, dismissals, starts, chats, newChats, built, finished, linked }` (`chats` = chats whose first start in the window used that surface's payload; `built` / `finished` / `linked` = those chats with a `build_queued` / `build_finished` / `link_done`), `unattributed` (chats with no surface start in the window), `byLanguage` (app impressions and taps per UI language), `tapRate`. It is `null` when `app_events` cannot be read; the web surfaces have impressions/taps 0 there because those are in Gaugemint.

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

## Query pack: promotion, retention, failures, caps

All read only, Supabase SQL editor. Change `interval '30 days'` as needed. Shared building blocks are repeated in each query so each one runs on its own.

### 1. Promotion funnel per surface (impressions -> taps -> bot starts -> builds -> finished builds -> linked)

App surfaces have impressions and taps; the website surfaces show 0 there (read them in Gaugemint) but still get the bot-side columns.

```sql
with map(surface, payload) as (values
  ('banner','app'), ('create_card','app_card'), ('post_build','app_build'),
  ('account_row','app_settings'), ('web_home','web_home'), ('web_connect','web_connect')),
promo as (
  select props->>'surface' as surface,
         count(*) filter (where event = 'promo_impression')              as impressions,
         count(distinct user_id) filter (where event = 'promo_impression') as people_seen,
         count(*) filter (where event = 'promo_tap')                     as taps,
         count(distinct user_id) filter (where event = 'promo_tap')      as people_tapped,
         count(*) filter (where event = 'promo_dismiss')                 as dismissals
  from app_events
  where event in ('promo_impression','promo_tap','promo_dismiss') and created_at >= now() - interval '30 days'
  group by 1),
first_start as (   -- each chat's first /start in the window, and the surface it came from
  select distinct on (chat_ref) chat_ref, props->>'start_payload' as payload
  from channel_events
  where channel = 'telegram' and event = 'start' and chat_ref is not null and created_at >= now() - interval '30 days'
  order by chat_ref, created_at),
steps as (
  select chat_ref, bool_or(event = 'build_queued') as built, bool_or(event = 'build_finished') as finished, bool_or(event = 'link_done') as linked
  from channel_events
  where channel = 'telegram' and chat_ref is not null and created_at >= now() - interval '30 days'
  group by 1)
select m.surface,
       coalesce(p.impressions, 0) as impressions, coalesce(p.people_seen, 0) as people_seen,
       coalesce(p.taps, 0) as taps, coalesce(p.people_tapped, 0) as people_tapped,
       round(coalesce(p.taps, 0)::numeric / nullif(p.impressions, 0), 3) as tap_rate,
       coalesce(p.dismissals, 0) as dismissals,
       count(f.chat_ref)                      as bot_chats,
       count(*) filter (where s.built)        as built,
       count(*) filter (where s.finished)     as finished,
       count(*) filter (where s.linked)       as linked
from map m
left join promo p       on p.surface = m.surface
left join first_start f on f.payload = m.payload
left join steps s       on s.chat_ref = f.chat_ref
group by m.surface, p.impressions, p.people_seen, p.taps, p.people_tapped, p.dismissals
order by impressions desc;
```

Reading it: `taps` vs `bot_chats` is the tap-to-start rate (not every tap ends in a /start: Telegram may not be installed, or the person never presses Start; a person can also start twice). Chats with no surface payload (typed the bot's name, a shared link) are in query 1b.

1b. Chats by where they started, including no surface:

```sql
select coalesce(props->>'start_payload', 'none') as payload, count(distinct chat_ref) as chats
from channel_events
where channel = 'telegram' and event = 'start' and created_at >= now() - interval '30 days'
group by 1 order by chats desc;
```

### 2. The same funnel per language

App language (what the person saw) on the app side, chat language (Telegram's language or the /language choice) on the bot side; they can differ.

```sql
with map(surface, payload) as (values
  ('banner','app'), ('create_card','app_card'), ('post_build','app_build'),
  ('account_row','app_settings'), ('web_home','web_home'), ('web_connect','web_connect')),
app as (
  select coalesce(props->>'lang', 'unknown') as lang, props->>'surface' as surface,
         count(*) filter (where event = 'promo_impression') as impressions,
         count(*) filter (where event = 'promo_tap')        as taps
  from app_events
  where event in ('promo_impression','promo_tap') and created_at >= now() - interval '30 days'
  group by 1, 2),
first_start as (
  select distinct on (chat_ref) chat_ref, language, props->>'start_payload' as payload
  from channel_events
  where channel = 'telegram' and event = 'start' and chat_ref is not null and created_at >= now() - interval '30 days'
  order by chat_ref, created_at),
steps as (
  select chat_ref, bool_or(event = 'build_queued') as built, bool_or(event = 'build_finished') as finished, bool_or(event = 'link_done') as linked
  from channel_events
  where channel = 'telegram' and chat_ref is not null and created_at >= now() - interval '30 days'
  group by 1),
bot as (
  select coalesce(f.language, 'unknown') as lang, m.surface,
         count(*) as chats, count(*) filter (where s.built) as built,
         count(*) filter (where s.finished) as finished, count(*) filter (where s.linked) as linked
  from first_start f join map m on m.payload = f.payload left join steps s on s.chat_ref = f.chat_ref
  group by 1, 2)
select coalesce(app.lang, bot.lang) as lang, coalesce(app.surface, bot.surface) as surface,
       app.impressions, app.taps, bot.chats, bot.built, bot.finished, bot.linked
from app full join bot on bot.lang = app.lang and bot.surface = app.surface
order by lang, surface;
```

### 3. Linked accounts: people who tapped, then linked (per person)

The one step that can be followed per person, because `link_done` carries the account id that the app event also has.

```sql
select t.surface,
       count(distinct t.user_id)                                    as people_tapped,
       count(distinct l.user_id)                                    as linked_after_tap,
       round(count(distinct l.user_id)::numeric / nullif(count(distinct t.user_id), 0), 3) as link_rate
from (select user_id, props->>'surface' as surface, min(created_at) as first_tap
      from app_events
      where event = 'promo_tap' and user_id is not null and created_at >= now() - interval '30 days'
      group by 1, 2) t
left join channel_events l
       on l.channel = 'telegram' and l.event = 'link_done' and l.user_id = t.user_id and l.created_at >= t.first_tap
group by 1 order by people_tapped desc;
```

### 4. Return rate: D1 and D7 of bot chats

A chat's day 0 is the day of its first recorded event. "Active" means at least one `update_received` (a message, command or button press) on that calendar day (UTC). A cohort day only counts toward a rate once day N is over.

```sql
with first_seen as (
  select chat_ref, min(created_at)::date as d0
  from channel_events where channel = 'telegram' and chat_ref is not null group by 1),
activity as (
  select distinct chat_ref, created_at::date as d
  from channel_events where channel = 'telegram' and event = 'update_received' and chat_ref is not null)
select f.d0 as cohort_day, count(*) as chats,
       count(*) filter (where f.d0 + 1 < current_date and exists (select 1 from activity a where a.chat_ref = f.chat_ref and a.d = f.d0 + 1)) as d1,
       round(count(*) filter (where f.d0 + 1 < current_date and exists (select 1 from activity a where a.chat_ref = f.chat_ref and a.d = f.d0 + 1))::numeric
             / nullif(count(*) filter (where f.d0 + 1 < current_date), 0), 3) as d1_rate,
       count(*) filter (where f.d0 + 7 < current_date and exists (select 1 from activity a where a.chat_ref = f.chat_ref and a.d = f.d0 + 7)) as d7,
       round(count(*) filter (where f.d0 + 7 < current_date and exists (select 1 from activity a where a.chat_ref = f.chat_ref and a.d = f.d0 + 7))::numeric
             / nullif(count(*) filter (where f.d0 + 7 < current_date), 0), 3) as d7_rate
from first_seen f
where f.d0 >= current_date - 45
group by 1 order by 1 desc;
```

### 5. Builds per chat

```sql
select builds, count(*) as chats
from (select chat_ref, count(*) filter (where event = 'build_queued') as builds
      from channel_events
      where channel = 'telegram' and chat_ref is not null and created_at >= now() - interval '30 days'
      group by 1) x
group by 1 order by 1;
```

### 6. Failure rate and reasons

`build_failed` can also come from a build that never started (`DISPATCH`, `REJECTED`, `BUSY`, `LIMIT`), so the rate is failed / (finished + failed).

```sql
select date_trunc('day', created_at)::date as day,
       count(*) filter (where event = 'build_finished') as finished,
       count(*) filter (where event = 'build_failed')   as failed,
       round(count(*) filter (where event = 'build_failed')::numeric
             / nullif(count(*) filter (where event in ('build_finished', 'build_failed')), 0), 3) as failure_rate
from channel_events
where channel = 'telegram' and created_at >= now() - interval '30 days'
group by 1 order by 1 desc;

select coalesce(props->>'error_code', 'UNKNOWN') as reason, count(*) as failures, count(distinct chat_ref) as chats
from channel_events
where channel = 'telegram' and event = 'build_failed' and created_at >= now() - interval '30 days'
group by 1 order by failures desc;
```

### 7. Time to first build

Seconds from a chat's first `/start` to its first accepted build and to its first finished build (median and 90th percentile).

```sql
with t as (
  select chat_ref,
         min(created_at) filter (where event = 'start')          as first_start,
         min(created_at) filter (where event = 'build_queued')   as first_queued,
         min(created_at) filter (where event = 'build_finished') as first_finished
  from channel_events
  where channel = 'telegram' and chat_ref is not null and created_at >= now() - interval '30 days'
  group by 1)
select count(*) filter (where first_start is not null)                                            as chats_started,
       count(*) filter (where first_queued >= first_start)                                        as built,
       percentile_cont(0.5) within group (order by extract(epoch from first_queued - first_start))   filter (where first_queued >= first_start)   as median_s_to_build,
       percentile_cont(0.9) within group (order by extract(epoch from first_queued - first_start))   filter (where first_queued >= first_start)   as p90_s_to_build,
       percentile_cont(0.5) within group (order by extract(epoch from first_finished - first_start)) filter (where first_finished >= first_start) as median_s_to_finished
from t;
```

### 8. Caps: unlinked-chat limits and every other limit

`anon_daily` is the per-chat daily cap for chats not linked to an account, `anon_global_daily` the all-chats cap for them. A chat that hits one and then links (`link_done`) is the cap doing its job.

```sql
select props->>'cap' as cap, count(*) as hits, count(distinct chat_ref) as chats
from channel_events
where channel = 'telegram' and event = 'rate_limited' and created_at >= now() - interval '30 days'
group by 1 order by hits desc;

select count(distinct c.chat_ref) as chats_hit_unlinked_cap,
       count(distinct c.chat_ref) filter (where exists (
         select 1 from channel_events l
         where l.channel = 'telegram' and l.event = 'link_done' and l.chat_ref = c.chat_ref and l.created_at >= c.created_at)) as linked_afterwards
from channel_events c
where c.channel = 'telegram' and c.event = 'rate_limited' and c.props->>'cap' in ('anon_daily', 'anon_global_daily')
  and c.created_at >= now() - interval '30 days';
```

### 9. Blocks and errors

```sql
select date_trunc('day', created_at)::date as day,
       count(*) filter (where event = 'bot_blocked')   as blocked,
       count(*) filter (where event = 'bot_unblocked') as unblocked,
       count(*) filter (where event = 'bot_error')     as bot_errors
from channel_events
where channel = 'telegram' and created_at >= now() - interval '30 days'
group by 1 order by 1 desc;
```

(`bot_blocked` / `bot_unblocked` stay at 0 until the webhook is set again with `my_chat_member` in `allowed_updates`.)

### 10. Website surfaces (Gaugemint)

Not in the database. In the Gaugemint dashboard for `vibebuild.cc`: page views of `/` (the home page), then the custom events `Telegram Section View` (the block scrolled into view) and `Telegram Click` split by property `surface` (`web_home`, `web_connect`), and page views of `/connect` (the bare page only: with an account or code in progress the tag is not loaded, by design). Compare `Telegram Click` with the bot starts for `web_home` / `web_connect` in query 1.

## Housekeeping

`telegram_updates` (de-duplication) is pruned by the bot every few hours (rows older than 3 days). `channel_events` rows are small; if wanted, `delete from channel_events where created_at < now() - interval '400 days';`. An account deletion removes that user's `channel_events` rows.
