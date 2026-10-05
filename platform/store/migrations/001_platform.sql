-- Platform tables for the vibe-proxy Fly app. Idempotent. Row level security is ON for every table and the only
-- policy grants the proxy's own role, so Supabase's anon and authenticated roles (or any other role) see nothing.
create schema if not exists platform;

create table if not exists platform.apps (
    app_id     text primary key check (app_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
    enabled    boolean not null default true,
    domains    text[] not null default '{}',
    manifest   jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists platform.app_secrets (
    app_id      text not null references platform.apps(app_id) on delete cascade,
    name        text not null check (name ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    ciphertext  bytea not null,
    nonce       bytea not null,
    key_version int not null default 1,
    updated_at  timestamptz not null default now(),
    primary key (app_id, name)
);

create table if not exists platform.limiter_counters (
    key        text primary key,
    n          bigint not null,
    expires_at timestamptz not null
);

create table if not exists platform.usage_events (
    id             bigserial primary key,
    ts             timestamptz not null,
    day            date not null,
    app_id         text not null,
    connector      text,
    status         int,
    outcome        text,
    request_bytes  int not null default 0,
    response_bytes int not null default 0,
    ms             int not null default 0
);
create index if not exists usage_events_app_day on platform.usage_events (app_id, day);

do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'vibe_proxy') then create role vibe_proxy; end if;
end $$;

revoke all on schema platform from public;
grant usage on schema platform to vibe_proxy;
grant select, insert, update, delete on all tables in schema platform to vibe_proxy;
grant usage, select on all sequences in schema platform to vibe_proxy;

do $$ declare t text; begin
    foreach t in array array['apps', 'app_secrets', 'limiter_counters', 'usage_events'] loop
        execute format('alter table platform.%I enable row level security', t);
        execute format('drop policy if exists proxy_all on platform.%I', t);
        execute format('create policy proxy_all on platform.%I to vibe_proxy using (true) with check (true)', t);
    end loop;
end $$;
