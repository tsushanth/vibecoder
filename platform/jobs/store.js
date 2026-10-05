// Postgres store for the job list of an app (platform.jobs) and its run log (platform.job_runs).
import { nextRunAt } from './schedule.js';

export function createJobsStore({ pool, now = () => Date.now() }) {
    return {
        /** The app's current data schema (tables only matter), or null. Reads app_dbs directly so it never provisions a database. */
        async getSpec(appId) {
            const { rows } = await pool.query('select spec from platform.app_dbs where app_id = $1', [appId]);
            return rows[0]?.spec || null;
        },

        /**
         * Replaces the app's job list with validated jobs. Jobs not listed are deleted. A job whose definition is unchanged and still
         * enabled keeps its schedule position and failure count; a new or changed job, or one that was auto-disabled, starts fresh.
         */
        async setJobs(appId, jobs) {
            const t = now();
            const client = await pool.connect();
            try {
                await client.query('begin');
                await client.query('delete from platform.jobs where app_id = $1 and job_id <> all($2::text[])', [appId, jobs.map((j) => j.id)]);
                for (const j of jobs) {
                    await client.query(
                        `insert into platform.jobs (app_id, job_id, spec, next_run_at) values ($1, $2, $3::jsonb, $4)
                         on conflict (app_id, job_id) do update set
                            next_run_at = case when platform.jobs.spec = excluded.spec and platform.jobs.enabled then platform.jobs.next_run_at else excluded.next_run_at end,
                            failures    = case when platform.jobs.spec = excluded.spec and platform.jobs.enabled then platform.jobs.failures else 0 end,
                            last_status = case when platform.jobs.spec = excluded.spec and platform.jobs.enabled then platform.jobs.last_status else null end,
                            spec = excluded.spec, enabled = true`,
                        [appId, j.id, JSON.stringify({ schedule: j.schedule, action: j.action }), new Date(nextRunAt(j.schedule, t))]);
                }
                await client.query('commit');
            } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
        },

        async getJobs(appId) {
            const { rows } = await pool.query('select job_id, spec, next_run_at, last_run_at, last_status, failures, enabled from platform.jobs where app_id = $1 order by job_id', [appId]);
            return rows.map((r) => ({ id: r.job_id, schedule: r.spec.schedule, action: r.spec.action, enabled: r.enabled, nextRunAt: r.next_run_at, lastRunAt: r.last_run_at, lastStatus: r.last_status, failures: r.failures }));
        },

        async recentRuns(appId, limit = 20) {
            const { rows } = await pool.query('select job_id, started_at, finished_at, status, error_code from platform.job_runs where app_id = $1 order by id desc limit $2', [appId, limit]);
            return rows.map((r) => ({ jobId: r.job_id, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, errorCode: r.error_code }));
        },
    };
}
