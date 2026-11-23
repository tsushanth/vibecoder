-- Telegram channel (bot inside the API) + channel-level metrics + project source channel.
-- Additive and idempotent. The API works without it: every write that depends on these objects is best effort and skips
-- quietly while they do not exist, so the migration and the code deploy can go in either order.
-- The Replitor project is shared with SimplyApply: only VibeBuild tables are touched here.
-- Rollback: drop table if exists telegram_updates, telegram_chats, channel_events;
--           alter table public.projects drop column if exists source_channel;

-- 1. Columns the existing /api/telegram routes already read and write (the SMS/WhatsApp bot also stores a phone number in
--    telegram_id). No-ops when they already exist.
alter table public.users
    add column if not exists telegram_id text,
    add column if not exists telegram_username text;
create index if not exists users_telegram_id_idx on public.users (telegram_id) where telegram_id is not null;

-- 2. Where a project was created: android | ios | web | telegram | sms | whatsapp | api. Descriptive analytics only.
--    Nullable: projects created before this migration stay null (read as 'unknown').
alter table public.projects add column if not exists source_channel text;
create index if not exists projects_source_channel_created_idx on public.projects (source_channel, created_at desc);

-- 3. One row per Telegram private chat: language choice, the anonymous VibeBuild user it builds as until the chat is linked
--    to a real account, and the build being followed (so a deploy or restart can resume the status message).
create table if not exists public.telegram_chats (
    telegram_id        text primary key,                 -- Telegram user id (= private chat id)
    language           text not null default 'en',       -- one of the 26 app languages (primary tag)
    language_chosen    boolean not null default false,   -- true once the person picked one with /language
    anon_user_id       text,                             -- users.user_id used for builds while the chat is not linked ('tg_<id>')
    display_name       text,
    username           text,
    start_payload      text,                             -- first /start payload (app, web, ...), for install attribution
    active_project_id  uuid,                             -- the build being followed, null when none
    active_message_id  bigint,                           -- the status message being edited
    active_started_at  timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists telegram_chats_created_idx on public.telegram_chats (created_at desc);

-- 4. Webhook de-duplication across restarts: Telegram retries an update until it gets a 200.
create table if not exists public.telegram_updates (
    update_id    bigint primary key,
    received_at  timestamptz not null default now()
);
create index if not exists telegram_updates_received_idx on public.telegram_updates (received_at);

-- 5. One row per interaction on any chat channel (telegram now; sms / whatsapp can write here too). Ids and short allow-listed
--    codes only: never message text, names or prompts. chat_ref is a keyed hash of the channel's own id.
create table if not exists public.channel_events (
    id          uuid primary key default gen_random_uuid(),
    channel     text not null,                           -- telegram | sms | whatsapp
    event       text not null,                           -- update_received, start, build_queued, build_finished, build_failed, link_done, ...
    language    text,
    chat_ref    text,
    user_id     text,                                    -- the VibeBuild user id the action ran as (real or tg_<id>), null if none
    project_id  uuid,
    props       jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    constraint channel_events_props_is_object check (jsonb_typeof(props) = 'object')
);
create index if not exists channel_events_channel_event_created_idx on public.channel_events (channel, event, created_at desc);
create index if not exists channel_events_chat_created_idx on public.channel_events (chat_ref, created_at desc);

-- Server-side only (the API uses the service role). No policies = no access for anon/authenticated.
alter table public.telegram_chats  enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.channel_events  enable row level security;
revoke all on table public.telegram_chats, public.telegram_updates, public.channel_events from anon, authenticated;
