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
    const extra = [];
    const track = (pl) => { pl.on('error', () => {}); extra.push(pl); return pl; }; // an idle client killed by teardown must not surface as a test error
    const pool = track(new pg.Pool({ ...conn(name), max: 10 }));
    if (migrate) await applyMigrations(pool);
    return {
        name, pool, admin, connFor: (opts) => track(new pg.Pool({ ...conn(name), max: 2, ...opts })),
        async cleanup() {
            // roles are cluster-wide: drop only the ones this database created, and leave the shared ones (vibe_proxy, proxy_sim, anon_sim)
            // alone so that other test runs using the same server are not disturbed
            const mine = (await pool.query('select role_name from platform.app_dbs').catch(() => ({ rows: [] }))).rows.map((r) => r.role_name);
            await Promise.all(extra.map((pl) => pl.end().catch(() => {})));
            await admin.query(`drop database if exists ${name} with (force)`).catch(() => {});
            for (const r of mine) await admin.query(`drop role if exists "${r}"`).catch(() => {});
            await admin.end().catch(() => {});
        },
    };
}
export const masterKey = () => randomBytes(32).toString('hex');
