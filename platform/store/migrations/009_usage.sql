-- Per-app usage metering and per-app limit overrides.
-- usage_daily is a compact rollup: one row per (app, day, kind), updated with upserts, so reads are cheap and the table stays small
-- (a few dozen rows per app per month). It holds counts, bytes, milliseconds and spend only: never request bodies, row contents,
-- email addresses, tokens or secrets. app_limits holds optional per-app overrides of the platform caps, editable only through the
-- admin API. Row level security is on and only the proxy's role may touch these tables, like the others.
create table if not exists platform.usage_daily (
    app_id       text   not null references platform.apps(app_id) on delete cascade,
    day          date   not null,
    kind         text   not null check (kind ~ '^[a-z_]{1,24}$'),
    calls        bigint not null default 0 check (calls >= 0),
    errors       bigint not null default 0 check (errors >= 0),
    bytes        bigint not null default 0 check (bytes >= 0),
    row_count    bigint not null default 0 check (row_count >= 0),
    ms           bigint not null default 0 check (ms >= 0),
    spend_micros bigint not null default 0 check (spend_micros >= 0),
    primary key (app_id, day, kind)
);
create index if not exists usage_daily_day on platform.usage_daily (day);

create table if not exists platform.app_limits (
    app_id     text primary key references platform.apps(app_id) on delete cascade,
    overrides  jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object'),
    updated_at timestamptz not null default now()
);

grant select, insert, update, delete on platform.usage_daily, platform.app_limits to vibe_proxy;

do $$ declare t text; begin
    foreach t in array array['usage_daily', 'app_limits'] loop
        execute format('alter table platform.%I enable row level security', t);
        execute format('drop policy if exists proxy_all on platform.%I', t);
        execute format('create policy proxy_all on platform.%I to vibe_proxy using (true) with check (true)', t);
    end loop;
end $$;
