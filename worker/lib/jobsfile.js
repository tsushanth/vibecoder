// Scheduled jobs for generated apps: the model declares them in vibe.jobs.json (refresh a table from a connector on a schedule,
// prune old rows). The file is untrusted model output: it is validated with a vendored copy of the platform's own validator
// (lib/jobs/validate.js, kept byte-identical by a test) against the app's own table schema and connectors, and only the normalised
// form is ever written. The platform validates again when the jobs are registered, so this is the early, fixable check.
// Problem texts contain only job ids, table and column names (and only when they look like names), never other model-written content.
import { validateJobs } from './jobs/validate.js';
import { KNOWN_CONNECTORS, declaredConnectors } from './connectors.js';
import { SCHEMA_FILE, parseSchemaFile } from './dataschema.js';

export const JOBS_FILE = 'vibe.jobs.json';
const MAX_BYTES = 16384;
const NAME_SHAPE = /^[A-Za-z0-9_-]{1,41}$/;
const safe = (n) => (NAME_SHAPE.test(String(n)) ? String(n) : '(invalid name)');

const MESSAGES = {
    not_an_object: 'must be a JSON object',
    unknown_key: 'has a key that is not allowed (allowed: version and jobs at the top; id, schedule and action per job; type, connector, method, path, query and save on a connector action; type, table and olderThanDays on a prune action)',
    bad_version: 'version must be 1',
    no_jobs: 'must have a "jobs" list',
    too_many_jobs: 'has too many jobs (max 5)',
    bad_job: 'each job must be an object',
    bad_job_id: 'job id must be lowercase letters, digits, - and _, starting with a letter (max 32 characters)',
    duplicate_job_id: 'duplicate job id: every job needs its own id',
    bad_schedule: 'schedule must be {"every":"15m"}, {"every":"1h"}, {"every":"6h"}, {"every":"1d"} or {"dailyAt":"HH:MM"} (UTC)',
    bad_action: 'action type must be "connector" or "prune"',
    not_yet: 'notify jobs are not supported yet: remove this job (the app can only email the signed-in user while they are using it)',
    bad_table: 'table name must be lowercase letters, digits and _, starting with a letter (not starting with pg_, not "sql")',
    bad_older_than_days: 'olderThanDays must be a whole number from 1 to 365',
    bad_connector: 'connector name must be lowercase letters, digits, - and _, starting with a letter',
    bad_method: 'method must be "GET"',
    bad_path: 'path must start with / and have no ?, #, backslash, // or dot segments (put query parameters in "query")',
    bad_query: 'query must be an object of up to 10 string, number or boolean values',
    bad_save: 'save must be {"table":"name","map":{"column":"/json/pointer"}} with 1 to 30 columns',
    reserved_column: 'id, user_id and created_at are added by the platform: never map them',
    bad_column: 'save.map has a column name that is not lowercase letters, digits and _ starting with a letter',
    bad_pointer: 'the save.map values must be JSON pointers into the response, such as "/properties/periods/0/temperature"',
};

const fail = (...problems) => ({ ok: false, manifest: null, problems });

/** Returns { ok, manifest, problems }. manifest is the normalised file content { version: 1, jobs }. Never throws.
 *  spec: the parsed schema spec ({ tables }) of the project, or null when it is missing. declared: connector names from vibe.manifest.json. */
export function parseJobsFile(text, { spec, declared = [] } = {}) {
    if (typeof text !== 'string' || !text.trim()) return fail(`${JOBS_FILE} is empty`);
    if (Buffer.byteLength(text) > MAX_BYTES) return fail(`${JOBS_FILE} is too large (max ${MAX_BYTES} bytes)`);
    let raw;
    try { raw = JSON.parse(text); } catch { return fail(`${JOBS_FILE} is not valid JSON`); }
    if (!spec || typeof spec !== 'object' || !spec.tables) return fail(`${JOBS_FILE} needs ${SCHEMA_FILE}: jobs save rows into a table, so declare that table in ${SCHEMA_FILE}`);
    const connectors = {};
    for (const n of [...KNOWN_CONNECTORS, ...declared]) connectors[n] = true;
    const v = validateJobs(raw, { tables: spec.tables, connectors });
    if (!v.ok) {
        const jobs = raw && typeof raw === 'object' && Array.isArray(raw.jobs) ? raw.jobs : [];
        const connectorOf = (id) => jobs.find((j) => j && j.id === id)?.action?.connector;
        const out = new Set();
        for (const e of v.errors) {
            const at = e.job !== undefined ? `${JOBS_FILE} job "${safe(e.job)}"` : JOBS_FILE;
            let msg;
            if (e.code === 'unknown_table') msg = `table "${safe(e.table)}" is not declared in ${SCHEMA_FILE} (declared: ${Object.keys(spec.tables).map((t) => `"${t}"`).join(', ') || 'none'})`;
            else if (e.code === 'unknown_connector') msg = `connector "${safe(connectorOf(e.job))}" does not exist (built-in: ${KNOWN_CONNECTORS.join(', ')}; any other must be declared in vibe.manifest.json)`;
            else if (e.code === 'unknown_column') msg = `column "${safe(e.column)}" of table "${safe(e.table)}" is not declared in ${SCHEMA_FILE} (columns: ${Object.keys(spec.tables[e.table]?.columns || {}).map((c) => `"${c}"`).join(', ')})`;
            else if (e.code === 'missing_required_column') msg = `required column "${safe(e.column)}" of table "${safe(e.table)}" must be mapped in save.map (or give the column a default in ${SCHEMA_FILE})`;
            else msg = `${MESSAGES[e.code] || 'is invalid'}${e.code === 'unknown_key' && e.field && NAME_SHAPE.test(e.field) ? ` ("${e.field}")` : ''}${e.column && e.code !== 'unknown_column' && e.code !== 'missing_required_column' && NAME_SHAPE.test(e.column) ? ` (column "${e.column}")` : ''}`;
            out.add(`${at}: ${msg}`);
        }
        return fail(...[...out].slice(0, 10));
    }
    if (!v.jobs.length) return fail(`${JOBS_FILE} declares no jobs: remove the file, or add the jobs the app needs`);
    const owner = v.warnings.filter((w) => w.code === 'owner_table_rows_have_no_owner');
    if (owner.length) {
        return fail(...owner.map((w) => `${JOBS_FILE} job "${safe(w.job)}" saves into table "${safe(w.table)}" which has access "owner", but rows written by a job have no user_id, so nobody could read them: set the table's access to public_read or authenticated in ${SCHEMA_FILE}`).slice(0, 10));
    }
    return { ok: true, manifest: { version: 1, jobs: v.jobs }, problems: [] };
}

/** Connector names used by the connector jobs written in the file (best effort, valid or not), so cross-checks do not double-report. */
export function jobConnectorNames(text) {
    try {
        const jobs = JSON.parse(text)?.jobs;
        if (!Array.isArray(jobs)) return [];
        return [...new Set(jobs.map((j) => j?.action).filter((a) => a && a.type === 'connector' && typeof a.connector === 'string').map((a) => a.connector))];
    } catch { return []; }
}

/** Problems the fix pass can act on for the project's jobs file(s). declared: connector names written in vibe.manifest.json (even if invalid). */
export function jobsProblems(files, declared = []) {
    const paths = Object.keys(files).filter((p) => p.split('/').pop() === JOBS_FILE);
    const problems = [];
    for (const p of paths) if (p !== JOBS_FILE) problems.push(`${JOBS_FILE} must be at the project root, not at ${p.slice(0, 60)}`);
    const text = files[JOBS_FILE];
    if (typeof text !== 'string') return problems;
    const schemaText = files[SCHEMA_FILE];
    if (typeof schemaText !== 'string') { problems.push(...parseJobsFile(text, { spec: null }).problems); return problems; }
    const s = parseSchemaFile(schemaText);
    if (!s.ok) return problems; // the schema problem is reported on its own; checking table names against a broken schema only adds noise
    problems.push(...parseJobsFile(text, { spec: s.spec, declared }).problems);
    return problems;
}

/** The validated, normalised jobs file text for a project, or null when there is nothing valid at the root (a valid schema is required). */
export function normalisedJobs(files) {
    const text = files?.[JOBS_FILE];
    if (typeof text !== 'string') return null;
    const s = parseSchemaFile(files?.[SCHEMA_FILE]);
    if (!s.ok) return null;
    const r = parseJobsFile(text, { spec: s.spec, declared: declaredConnectors(files) });
    return r.ok ? `${JSON.stringify(r.manifest, null, 2)}\n` : null;
}
