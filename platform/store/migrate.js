// Applies store/migrations/*.sql in filename order, once each, under an advisory lock.
// Usage: DATABASE_URL=... node store/migrate.js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 7_424_001;
const sum = (text) => crypto.createHash('sha256').update(text).digest('hex');

export async function applyMigrations(pool, { dir = DEFAULT_DIR } = {}) {
    const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const client = await pool.connect();
    const applied = [], skipped = [];
    try {
        await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
        await client.query(`create schema if not exists platform;
            create table if not exists platform.schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now());
            alter table platform.schema_migrations enable row level security;`);
        const done = new Map((await client.query('select name, checksum from platform.schema_migrations')).rows.map((r) => [r.name, r.checksum]));
        for (const f of files) {
            const text = fs.readFileSync(path.join(dir, f), 'utf8');
            const checksum = sum(text);
            if (done.has(f)) {
                if (done.get(f) !== checksum) throw new Error(`migration ${f} changed after it was applied; add a new migration instead`);
                skipped.push(f);
                continue;
            }
            try {
                await client.query('begin');
                await client.query(text);
                await client.query('insert into platform.schema_migrations (name, checksum) values ($1, $2)', [f, checksum]);
                await client.query('commit');
            } catch (e) {
                await client.query('rollback').catch(() => {});
                throw new Error(`migration ${f} failed: ${String(e.message).slice(0, 200)}`);
            }
            applied.push(f);
        }
        return { applied, skipped };
    } finally {
        await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
        client.release();
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const { default: pg } = await import('pg');
    if (!process.env.DATABASE_URL) { console.error('missing required setting DATABASE_URL'); process.exit(2); }
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
        const r = await applyMigrations(pool);
        console.log(JSON.stringify({ event: 'migrate', applied: r.applied, skipped: r.skipped }));
    } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await pool.end(); }
}
