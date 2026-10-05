import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';

const INDEX = fileURLToPath(new URL('../index.js', import.meta.url));
let db, skip;
before(async () => { db = await scratchDb(); if (db.unavailable) skip = db.unavailable; });
after(async () => { if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); await f(c); });

function run(env) {
    const child = spawn(process.execPath, [INDEX], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
    return { child, exited, out: () => out, err: () => err };
}
const goodEnv = (port) => ({ DATABASE_URL: `postgres://${process.env.USER}@localhost:${process.env.PGPORT || 5432}/${db.name}`, VIBE_MASTER_KEY: masterKey(), OPENROUTER_API_KEY: 'sk-or-v1-FAKEINDEX', BASE_DOMAIN: 'vibebuild.cc', PROXY_ADMIN_TOKEN: 'admin-' + 'i'.repeat(40), PORT: String(port) });
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); } };

t('exits 1 naming the missing setting and never printing secrets', async () => {
    const env = goodEnv(44124); delete env.DATABASE_URL;
    const p = run({ ...env, VIBE_MASTER_KEY: 'abc123SECRETSHOULDNOTPRINT' });
    const { code } = await p.exited;
    assert.equal(code, 1);
    assert.match(p.err(), /DATABASE_URL/);
    assert.equal((p.out() + p.err()).includes('abc123SECRETSHOULDNOTPRINT'), false);
});

t('starts, serves /health on PORT, logs a start line without secrets, and exits 0 on SIGTERM', async () => {
    const port = 43000 + Math.floor(Math.random() * 2000);
    const env = goodEnv(port); const p = run(env);
    const r = await until(async () => { const x = await fetch(`http://127.0.0.1:${port}/health`); return x.status === 200 ? x : null; });
    assert.deepEqual(await r.json(), { ok: true });
    await until(() => /"event":"started"/.test(p.out()));
    p.child.kill('SIGTERM');
    const { code } = await p.exited;
    assert.equal(code, 0);
    const all = p.out() + p.err();
    for (const bad of [env.VIBE_MASTER_KEY, 'sk-or-v1-FAKEINDEX']) assert.equal(all.includes(bad), false);
});

t('exits 1 with a clear message when the schema is not migrated', async () => {
    const bare = await scratchDb({ migrate: false });
    try {
        const p = run({ ...goodEnv(44123), DATABASE_URL: `postgres://${process.env.USER}@localhost:${process.env.PGPORT || 5432}/${bare.name}` });
        const { code } = await p.exited;
        assert.equal(code, 1); assert.match(p.err(), /migrat/i);
    } finally { await bare.cleanup(); }
});
