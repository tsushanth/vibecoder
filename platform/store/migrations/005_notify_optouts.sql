-- End-user notification opt-outs. A row means: never email this user on behalf of this app. Checked before every send.
-- Keyed by (app_id, user_id) with no cross-app references; deleting the user or the app removes the row. Row level
-- security is on and only the proxy's role may touch it, like the other end-user tables.
create table if not exists platform.notify_optouts (
    app_id       text not null references platform.apps(app_id) on delete cascade,
    user_id      uuid not null,
    opted_out_at timestamptz not null default now(),
    primary key (app_id, user_id),
    foreign key (app_id, user_id) references platform.end_users (app_id, id) on delete cascade
);

alter table platform.notify_optouts enable row level security;
drop policy if exists proxy_all on platform.notify_optouts;
create policy proxy_all on platform.notify_optouts to vibe_proxy using (true) with check (true);
grant select, insert, update, delete on platform.notify_optouts to vibe_proxy;
