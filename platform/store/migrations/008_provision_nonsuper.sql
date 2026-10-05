-- provision_app_db must also work when its owner is not a superuser (Supabase's postgres role): creating a schema "authorization"
-- an app role needs the owner to be able to SET ROLE to it, and a CREATEROLE role that creates a role gets ADMIN but not SET.
-- So the owner grants itself SET (no INHERIT) on each role it creates. Existing app roles are repaired the same way.
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
        h := substr(md5(current_database() || ':' || p_app_id), 1, 20);
        r := 'appr_' || h;
        s := 'apps_' || h;
        if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
        if not pg_has_role(current_user, r, 'SET') then execute format('grant %I to %I with set true, inherit false', r, current_user); end if;
        -- created by the function owner, then handed over: the owner may not revoke on a schema that another role already owns
        execute format('create schema if not exists %I', s);
        execute format('revoke all on schema %I from public', s);
        execute format('alter schema %I owner to %I', s, r);
        execute format('grant %I to vibe_proxy with inherit false, set true', r);
        insert into platform.app_dbs (app_id, role_name, schema_name) values (p_app_id, r, s);
    end if;
    return query select r, s;
end
$fn$;
revoke all on function platform.provision_app_db(text) from public;
grant execute on function platform.provision_app_db(text) to vibe_proxy;
