-- Declarative scheduled jobs (vibe.jobs.json). One row per job per app, plus a run log that records an error CODE only,
-- never a response body. Same shape as 002: keyed by app_id, no cross-app references, RLS on, proxy role only.
create table if not exists platform.jobs (
    app_id      text not null references platform.apps(app_id) on delete cascade,
    job_id      text not null check (job_id ~ '^[a-z][a-z0-9_-]{0,31}$'),
    spec        jsonb not null,
    next_run_at timestamptz not null,
    last_run_at timestamptz,
    last_status text,
    failures    int not null default 0,
    enabled     boolean not null default true,
    primary key (app_id, job_id)
);
create index if not exists jobs_due on platform.jobs (next_run_at) where enabled;

create table if not exists platform.job_runs (
    id          bigint generated always as identity primary key,
    app_id      text not null references platform.apps(app_id) on delete cascade,
    job_id      text not null,
    started_at  timestamptz not null,
    finished_at timestamptz,
    status      text not null check (status in ('running', 'ok', 'error', 'skipped')),
    error_code  text check (error_code is null or error_code ~ '^[a-z0-9_]{1,40}$')
);
create index if not exists job_runs_app_day on platform.job_runs (app_id, started_at);

grant select, insert, update, delete on platform.jobs, platform.job_runs to vibe_proxy;

do $$ declare t text; begin
    foreach t in array array['jobs', 'job_runs'] loop
        execute format('alter table platform.%I enable row level security', t);
        execute format('drop policy if exists proxy_all on platform.%I', t);
        execute format('create policy proxy_all on platform.%I to vibe_proxy using (true) with check (true)', t);
    end loop;
end $$;
