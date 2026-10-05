// Validates vibe.jobs.json: the declarative scheduled jobs an app asks for. The file is untrusted input.
// Pure: no I/O. With a context ({ tables, connectors }) it also checks names against the app's data schema and connectors.
import { NAME } from '../data/schema.js';
import { EVERY_MS } from './schedule.js';

export const MAX_JOBS = 5;
export const MAX_SAVE_COLUMNS = 30;
const JOB_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const CONNECTOR = /^[a-z][a-z0-9_-]{0,31}$/;
const DAILY_AT = /^([01]\d|2[0-3]):[0-5]\d$/;
const POINTER = /^(\/([^/~]|~[01])*)+$/;
const QUERY_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const RESERVED_COLUMNS = new Set(['id', 'user_id', 'created_at']);
const MAX_POINTER_LEN = 200;
const MAX_POINTER_DEPTH = 8;
const MAX_PATH = 200;
const MAX_QUERY_KEYS = 10;
const MAX_QUERY_VALUE = 200;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasOnly = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const validTable = (t) => typeof t === 'string' && NAME.test(t) && !t.startsWith('pg_') && t !== 'sql';
const pathOk = (p) => typeof p === 'string' && p.length >= 1 && p.length <= MAX_PATH && p.startsWith('/') && !/[?#\\]/.test(p) && !/%2f|%5c/i.test(p) && !p.includes('//') && !p.split('/').some((s) => s === '..' || s === '.');
const pointerOk = (p) => typeof p === 'string' && p.length <= MAX_POINTER_LEN && POINTER.test(p) && p.split('/').length - 1 <= MAX_POINTER_DEPTH;

/**
 * input: the parsed vibe.jobs.json, { version?: 1, jobs: [...] }.
 * ctx: { tables?: spec.tables, connectors?: object keyed by connector name (built-ins included) }.
 * Returns { ok: true, jobs, warnings } with normalized copies, or { ok: false, errors: [{ code, job?, field?, table?, column?, message? }] }.
 */
export function validateJobs(input, ctx = {}) {
    const errors = [];
    const warnings = [];
    if (!isObj(input)) return { ok: false, errors: [{ code: 'not_an_object' }] };
    for (const k of Object.keys(input)) if (k !== 'version' && k !== 'jobs') errors.push({ code: 'unknown_key', field: String(k).slice(0, 40) });
    if (input.version !== undefined && input.version !== 1) errors.push({ code: 'bad_version' });
    if (!Array.isArray(input.jobs)) return { ok: false, errors: [...errors, { code: 'no_jobs' }] };
    if (input.jobs.length > MAX_JOBS) errors.push({ code: 'too_many_jobs' });

    const hasTables = ctx.tables !== undefined;
    const hasConnectors = ctx.connectors !== undefined;
    const seen = new Set();
    const jobs = [];

    for (const raw of input.jobs.slice(0, MAX_JOBS + 1)) {
        if (!isObj(raw)) { errors.push({ code: 'bad_job' }); continue; }
        const id = typeof raw.id === 'string' && JOB_ID.test(raw.id) ? raw.id : null;
        const at = id || (typeof raw.id === 'string' ? raw.id.slice(0, 40) : undefined);
        const err = (code, extra = {}) => errors.push({ code, ...(at !== undefined ? { job: at } : {}), ...extra });
        if (!id) err('bad_job_id');
        else if (seen.has(id)) err('duplicate_job_id');
        else seen.add(id);
        for (const k of Object.keys(raw)) if (!['id', 'schedule', 'action'].includes(k)) err('unknown_key', { field: String(k).slice(0, 40) });

        const schedule = checkSchedule(raw.schedule);
        if (!schedule) err('bad_schedule');
        const action = checkAction(raw.action, err, id);
        if (id && schedule && action) jobs.push({ id, schedule, action });
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, jobs, warnings };

    function checkSchedule(s) {
        if (!isObj(s)) return null;
        if (own(s, 'every')) {
            if (!hasOnly(s, ['every']) || typeof s.every !== 'string' || !own(EVERY_MS, s.every)) return null;
            return { every: s.every };
        }
        if (own(s, 'dailyAt')) {
            if (!hasOnly(s, ['dailyAt', 'tz']) || typeof s.dailyAt !== 'string' || !DAILY_AT.test(s.dailyAt)) return null;
            if (s.tz !== undefined && s.tz !== 'UTC') return null;
            return { dailyAt: s.dailyAt, tz: 'UTC' };
        }
        return null;
    }

    function checkTable(table, err) {
        if (!validTable(table)) { err('bad_table'); return false; }
        if (hasTables && !(ctx.tables && own(ctx.tables, table))) { err('unknown_table', { table }); return false; }
        return true;
    }

    function checkAction(a, err, jobId) {
        if (!isObj(a)) { err('bad_action'); return null; }
        if (a.type === 'notify') { err('not_yet', { message: 'notify jobs are not available yet' }); return null; }
        if (a.type === 'prune') {
            if (!hasOnly(a, ['type', 'table', 'olderThanDays'])) err('unknown_key');
            const tableOk = checkTable(a.table, err);
            const days = Number.isInteger(a.olderThanDays) && a.olderThanDays >= 1 && a.olderThanDays <= 365;
            if (!days) err('bad_older_than_days');
            return tableOk && days && hasOnly(a, ['type', 'table', 'olderThanDays']) ? { type: 'prune', table: a.table, olderThanDays: a.olderThanDays } : null;
        }
        if (a.type === 'connector') return checkConnector(a, err, jobId);
        err('bad_action');
        return null;
    }

    function checkConnector(a, err, jobId) {
        let good = true;
        const bad = (code, extra) => { good = false; err(code, extra); };
        if (!hasOnly(a, ['type', 'connector', 'method', 'path', 'query', 'save'])) bad('unknown_key');
        if (typeof a.connector !== 'string' || !CONNECTOR.test(a.connector)) bad('bad_connector');
        else if (hasConnectors && !(ctx.connectors && own(ctx.connectors, a.connector))) bad('unknown_connector');
        if (a.method !== 'GET') bad('bad_method');
        if (!pathOk(a.path)) bad('bad_path');
        let query;
        if (a.query !== undefined) {
            const q = a.query;
            const entries = isObj(q) ? Object.entries(q) : null;
            if (!entries || entries.length > MAX_QUERY_KEYS || !entries.every(([k, v]) => QUERY_KEY.test(k) && ((typeof v === 'string' && v.length <= MAX_QUERY_VALUE) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean'))) bad('bad_query');
            else query = { ...q };
        }
        const s = a.save;
        let save;
        if (!isObj(s) || !isObj(s.map)) bad('bad_save');
        else {
            if (!hasOnly(s, ['table', 'map'])) bad('unknown_key');
            const tableOk = checkTable(s.table, err);
            if (!tableOk) good = false;
            const cols = Object.entries(s.map);
            if (cols.length < 1 || cols.length > MAX_SAVE_COLUMNS) bad('bad_save');
            else {
                const map = {};
                for (const [col, ptr] of cols) {
                    if (RESERVED_COLUMNS.has(col)) { bad('reserved_column', { column: col.slice(0, 41) }); continue; }
                    if (!NAME.test(col)) { bad('bad_column', { column: col.slice(0, 41) }); continue; }
                    if (tableOk && hasTables && !own(ctx.tables[s.table].columns, col)) { bad('unknown_column', { table: s.table, column: col }); continue; }
                    if (!pointerOk(ptr)) { bad('bad_pointer', { column: col }); continue; }
                    map[col] = ptr;
                }
                if (tableOk && hasTables) {
                    for (const [col, def] of Object.entries(ctx.tables[s.table].columns)) if (def.required && def.default === undefined && !own(s.map, col)) bad('missing_required_column', { table: s.table, column: col });
                    if (ctx.tables[s.table].access === 'owner' && good) warnings.push({ code: 'owner_table_rows_have_no_owner', job: jobId, table: s.table });
                }
                if (tableOk) save = { table: s.table, map };
            }
        }
        return good ? { type: 'connector', connector: a.connector, method: 'GET', path: a.path, ...(query ? { query } : {}), save } : null;
    }
}
