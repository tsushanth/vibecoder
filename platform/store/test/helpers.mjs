import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyMigrations } from '../migrate.js';

const conn = (db) => ({ host: process.env.PGHOST || 'localhost', user: process.env.PGUSER || process.env.USER, database: db });
export const MIGRATION = fileURLToPath(new URL('../migrations/001_platform.sql', import.meta.url));

/** Creates a throwaway database owned by this test run, applies the migration, returns pools and a cleanup. */
export async function scratchDb({ migrate = true } = {}) {
    const name = `vibe_platform_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Pool({ ...conn('postgres'), max: 1 });
    try { await admin.query(`create database ${name}`); } catch (e) { await admin.end().catch(() => {}); return { unavailable: String(e.message) }; }
    const pool = new pg.Pool({ ...conn(name), max: 10 });
    if (migrate) await applyMigrations(pool);
    return {
        name, pool, admin, connFor: (extra) => new pg.Pool({ ...conn(name), max: 2, ...extra }),
        async cleanup() { await pool.end().catch(() => {}); await admin.query(`drop database if exists ${name} with (force)`).catch(() => {}); const app = (await admin.query("select rolname from pg_roles where rolname like 'appr\\_%' or rolname = 'proxy_sim'").catch(() => ({ rows: [] }))).rows.map((r) => r.rolname); for (const r of [...app, 'anon_sim', 'vibe_proxy']) await admin.query(`drop role if exists "${r}"`).catch(() => {}); await admin.end().catch(() => {}); },
    };
}
export const masterKey = () => randomBytes(32).toString('hex');
