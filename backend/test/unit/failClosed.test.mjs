import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOOD = { WORKER_SECRET: 'unit-test-worker-secret-0123456789', INTERNAL_SECRET: 'unit-test-internal-secret-0123456789' };
const baseEnv = { PATH: process.env.PATH, SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'test-anon-key', NODE_ENV: 'test' };
const load = (file, env) => spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(path.join(ROOT, file))}); process.exit(0);`], { env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 20000 });

for (const [file, name] of [['config/constants.js', 'WORKER_SECRET'], ['routes/deploy.routes.js', 'INTERNAL_SECRET'], ['routes/deploy.routes.js', 'WORKER_SECRET']]) {
    test(`${file} refuses to load without ${name} and names it`, () => {
        const env = { ...GOOD }; delete env[name];
        const r = load(file, env);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, new RegExp(name));
    });
    test(`${file} refuses to load with a too-short ${name}, without printing it`, () => {
        const r = load(file, { ...GOOD, [name]: 'tinysecret' });
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, new RegExp(name));
        assert.equal(r.stderr.includes('tinysecret'), false);
    });
}

test('both modules load normally when the secrets are set', () => {
    for (const file of ['config/constants.js', 'routes/deploy.routes.js']) {
        const r = load(file, GOOD);
        assert.equal(r.status, 0, `${file}: ${r.stderr.slice(0, 300)}`);
    }
});

test('no built-in secret default remains in the backend source', () => {
    const r = spawnSync('git', ['grep', '-nE', "(WORKER_SECRET|INTERNAL_SECRET)[^|\\n]*\\|\\|[[:space:]]*['\\\"]", '--', 'config', 'routes', 'server.js', 'services', 'lib'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.stdout.trim(), '');
});
