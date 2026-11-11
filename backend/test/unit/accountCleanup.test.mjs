import '../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { repoNamesFor, deleteProjectRepos, deleteThumbnails, deleteAppKeys, deleteAccountExternalData } = await import('../../lib/accountCleanup.js');

const P1 = '0123abcd-0123-4abc-8def-0123456789ab';
const P2 = '9999abcd-0123-4abc-8def-0123456789ab';
const quiet = () => {};
const logs = () => { const l = []; return { l, log: (m) => l.push(m) }; };

test('repoNamesFor: the stored name plus app-<id> for every project, deduplicated, junk names dropped', () => {
    assert.deepEqual(repoNamesFor([{ id: P1, github_repo: `app-${P1}` }, { id: P2, github_repo: null }, { id: 'short', github_repo: 'owner/other' }]).sort(), [`app-${P1}`, `app-${P2}`].sort());
    assert.deepEqual(repoNamesFor(null), []);
});

test('repos: one DELETE per repo to the worker with the worker secret; already-gone (200) is success', async () => {
    const calls = [];
    const fetchImpl = async (url, o) => { calls.push({ url: String(url), method: o.method, secret: o.headers['x-worker-secret'] }); return new Response('{"success":true,"alreadyGone":true}', { status: 200 }); };
    const out = await deleteProjectRepos([`app-${P1}`, `app-${P2}`], { fetchImpl, workerUrl: 'http://w.test', workerSecret: 's3', log: quiet });
    assert.deepEqual(out, { total: 2, failed: 0 });
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`).sort(), [`DELETE http://w.test/repo/app-${P1}`, `DELETE http://w.test/repo/app-${P2}`].sort());
    assert.ok(calls.every((c) => c.secret === 's3'));
});

test('repos: a worker 404 (route not deployed), 502 or a network error is a failure, the rest still run, and the log has no names', async () => {
    const { l, log } = logs();
    const fetchImpl = async (url) => {
        if (String(url).endsWith(P1)) return new Response('x', { status: 404 });
        if (String(url).endsWith(P2)) throw new Error('ECONNREFUSED');
        return new Response('{}', { status: 200 });
    };
    const out = await deleteProjectRepos([`app-${P1}`, `app-${P2}`, 'app-ffffffff-0000'], { fetchImpl, workerUrl: 'http://w.test', workerSecret: 's', log });
    assert.deepEqual(out, { total: 3, failed: 2 });
    assert.equal(l.length, 1);
    assert.ok(!l[0].includes(P1) && !l[0].includes(P2) && !l[0].includes('app-'), l[0]);
});

test('screenshots: removes thumbnails/<id>.jpg from project-assets in batches of 100', async () => {
    const removed = []; let bucket = null;
    const storage = { from: (b) => { bucket = b; return { remove: async (paths) => { removed.push(paths); return { data: [], error: null }; } }; } };
    const ids = Array.from({ length: 205 }, (_, i) => `id-${String(i).padStart(4, '0')}`);
    const out = await deleteThumbnails(ids, storage, { log: quiet });
    assert.equal(bucket, 'project-assets');
    assert.deepEqual(out, { total: 205, failed: 0 });
    assert.deepEqual(removed.map((r) => r.length), [100, 100, 5]);
    assert.equal(removed[0][0], 'thumbnails/id-0000.jpg');
});

test('screenshots: a storage error or throw is counted as failed; ids that could form a path trick are skipped', async () => {
    const mk = (fn) => ({ from: () => ({ remove: fn }) });
    assert.deepEqual(await deleteThumbnails([P1], mk(async () => ({ data: null, error: { statusCode: '500' } })), { log: quiet }), { total: 1, failed: 1 });
    assert.deepEqual(await deleteThumbnails([P1], mk(async () => { throw new Error('net'); }), { log: quiet }), { total: 1, failed: 1 });
    const seen = [];
    await deleteThumbnails(['../x', 'a/b', P1], mk(async (p) => { seen.push(...p); return { data: [], error: null }; }), { log: quiet });
    assert.deepEqual(seen, [`thumbnails/${P1}.jpg`]);
});

test('keys: every secret of every app (project-id apps and subdomain apps) is deleted; an unknown app holds none', async () => {
    const store = { [P1]: ['OPENAI_KEY', 'STRIPE_KEY'], 'my-app': ['OPENAI_KEY'] };
    const deleted = [];
    const proxyAdmin = {
        configured: true,
        listSecrets: async (id) => { if (!(id in store)) throw Object.assign(new Error('x'), { code: 'unknown_app', status: 404 }); return store[id].map((name) => ({ name })); },
        deleteSecret: async (id, name) => { deleted.push(`${id}/${name}`); },
    };
    const out = await deleteAppKeys([P1, P2, 'my-app', 'my-app'], proxyAdmin, { log: quiet });
    assert.deepEqual(out, { total: 3, failed: 0, deleted: 3 });
    assert.deepEqual(deleted.sort(), [`${P1}/OPENAI_KEY`, `${P1}/STRIPE_KEY`, 'my-app/OPENAI_KEY'].sort());
});

test('keys: a proxy outage or a failed delete is a failure (retry), and the log carries codes only', async () => {
    const { l, log } = logs();
    const down = { configured: true, listSecrets: async () => { throw Object.assign(new Error('x'), { code: 'unreachable' }); }, deleteSecret: async () => {} };
    assert.deepEqual(await deleteAppKeys([P1], down, { log }), { total: 1, failed: 1, deleted: 0 });
    const stuck = { configured: true, listSecrets: async () => [{ name: 'SECRET_NAME_X' }], deleteSecret: async () => { throw Object.assign(new Error('x'), { code: 'http_500' }); } };
    assert.equal((await deleteAppKeys([P1], stuck, { log })).failed, 1);
    assert.ok(l.every((m) => !m.includes('SECRET_NAME_X') && !m.includes(P1)));
});

test('keys: no proxy configured is skipped, not failed', async () => {
    assert.deepEqual(await deleteAppKeys([P1], { configured: false }, { log: quiet }), { total: 1, failed: 0, deleted: 0, skipped: true });
});

test('all together: reports exactly which steps failed and never throws', async () => {
    const ok = new Response('{}', { status: 200 });
    const out = await deleteAccountExternalData({
        projects: [{ id: P1, github_repo: `app-${P1}` }], subdomains: ['my-app'],
        fetchImpl: async () => new Response('x', { status: 502 }),
        storage: { from: () => ({ remove: async () => { throw new Error('boom'); } }) },
        proxyAdmin: { configured: true, listSecrets: async () => [], deleteSecret: async () => {} },
        log: quiet,
    });
    assert.deepEqual(out, { failed: ['github', 'screenshots'] });
    void ok;
});
