-- Per-app SQL databases inside the shared project: one schema and one NOLOGIN role per app. The proxy's login role may
-- SET ROLE into an app role (never inherit it), so app code and DDL run with that app's privileges only.
-- provision_app_db is SECURITY DEFINER: it runs as the role that applied this migration (it needs CREATEROLE) so the proxy
-- login itself never has CREATEROLE.
create table if not exists platform.app_dbs (
    app_id      text primary key references platform.apps(app_id) on delete cascade,
    role_name   text not null unique check (role_name ~ '^appr_[0-9a-f]{20}$'),
    schema_name text not null unique check (schema_name ~ '^apps_[0-9a-f]{20}$'),
    spec        jsonb,
    version     int not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
alter table platform.app_dbs enable row level security;
drop policy if exists proxy_all on platform.app_dbs;
create policy proxy_all on platform.app_dbs to vibe_proxy using (true) with check (true);
grant select, insert, update, delete on platform.app_dbs to vibe_proxy;

create or replace function platform.provision_app_db(p_app_id text)
returns table (role_name text, schema_name text)
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $fn$
declare h text; r text; s text;
begin
    if p_app_id is null or p_app_id !~ '^[a-z0-9][a-z0-9-]{0,62}$' then raise exception 'invalid app id'; end if;
    if not exists (select 1 from platform.apps a where a.app_id = p_app_id) then raise exception 'unknown app'; end if;
    select d.role_name, d.schema_name into r, s from platform.app_dbs d where d.app_id = p_app_id;
    if r is null then
        -- the database name is part of the hash so that roles (which are cluster-wide) never collide between databases, e.g. test databases
        h := substr(md5(current_database() || ':' || p_app_id), 1, 20);
        r := 'appr_' || h;
        s := 'apps_' || h;
        if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
        execute format('create schema if not exists %I authorization %I', s, r);
        execute format('revoke all on schema %I from public', s);
        execute format('grant %I to vibe_proxy with inherit false, set true', r);
        insert into platform.app_dbs (app_id, role_name, schema_name) values (p_app_id, r, s);
    end if;
    return query select r, s;
end
$fn$;
revoke all on function platform.provision_app_db(text) from public;
grant execute on function platform.provision_app_db(text) to vibe_proxy;
