-- End-user accounts for generated apps: magic-link sign-in with per-app JWT sessions. Everything is keyed by app_id, with no
-- cross-app references, so one app's accounts can be exported with its schema. Row level security is on and only the
-- proxy's role may touch these tables.
create table if not exists platform.end_users (
    app_id     text not null references platform.apps(app_id) on delete cascade,
    id         uuid not null default gen_random_uuid(),
    email      text not null check (email = lower(email) and length(email) <= 254),
    created_at timestamptz not null default now(),
    primary key (app_id, id),
    unique (app_id, email)
);

create table if not exists platform.login_links (
    token_hash bytea primary key,
    app_id     text not null references platform.apps(app_id) on delete cascade,
    email      text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at    timestamptz
);
create index if not exists login_links_expiry on platform.login_links (expires_at);

create table if not exists platform.sessions (
    jti        text primary key,
    app_id     text not null references platform.apps(app_id) on delete cascade,
    user_id    uuid not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    foreign key (app_id, user_id) references platform.end_users (app_id, id) on delete cascade
);
create index if not exists sessions_user on platform.sessions (app_id, user_id);

grant select, insert, update, delete on all tables in schema platform to vibe_proxy;

do $$ declare t text; begin
    foreach t in array array['end_users', 'login_links', 'sessions'] loop
        execute format('alter table platform.%I enable row level security', t);
        execute format('drop policy if exists proxy_all on platform.%I', t);
        execute format('create policy proxy_all on platform.%I to vibe_proxy using (true) with check (true)', t);
    end loop;
end $$;
