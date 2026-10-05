-- File storage for generated apps: metadata only; the bytes live in the object store under app_id/user_id/... keys.
create table if not exists platform.files (
    id           uuid primary key default gen_random_uuid(),
    app_id       text not null references platform.apps(app_id) on delete cascade,
    user_id      uuid not null,
    object_key   text not null unique,
    name         text not null,
    content_type text not null,
    bytes        bigint not null check (bytes >= 0),
    is_public    boolean not null default false,
    created_at   timestamptz not null default now(),
    foreign key (app_id, user_id) references platform.end_users (app_id, id) on delete cascade
);
create index if not exists files_app_user on platform.files (app_id, user_id, created_at desc);
alter table platform.files enable row level security;
drop policy if exists proxy_all on platform.files;
create policy proxy_all on platform.files to vibe_proxy using (true) with check (true);
grant select, insert, update, delete on platform.files to vibe_proxy;
