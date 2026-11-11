import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteAppRepo, isAppRepoName } from '../lib/githubRepo.js';

const PAT = 'github_pat_' + 'X'.repeat(30);
const NAME = 'app-0123abcd-0123-4abc-8def-0123456789ab';
const reply = (status) => { const calls = []; return { calls, fetchImpl: async (url, o) => { calls.push({ url: String(url), o }); return new Response(null, { status }); } }; };

test('only app-<projectId> names are accepted', () => {
    assert.equal(isAppRepoName(NAME), true);
    for (const bad of ['', 'main', '../x', 'app-', 'app-a/b', 'owner/app-0123abcd-0123', 'app-0123abcd?x=1', null, 42]) assert.equal(isAppRepoName(bad), false, String(bad));
});

test('204 deletes the repo: DELETE to api.github.com with the token', async () => {
    const f = reply(204);
    assert.deepEqual(await deleteAppRepo({ pat: PAT, org: 'Org', repoName: NAME, fetchImpl: f.fetchImpl }), { ok: true, alreadyGone: false });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, `https://api.github.com/repos/Org/${NAME}`);
    assert.equal(f.calls[0].o.method, 'DELETE');
    assert.equal(f.calls[0].o.headers.Authorization, `Bearer ${PAT}`);
});

test('404 (already deleted or never created) is success', async () => {
    assert.deepEqual(await deleteAppRepo({ pat: PAT, org: 'Org', repoName: NAME, fetchImpl: reply(404).fetchImpl }), { ok: true, alreadyGone: true });
});

test('403, 500 and a network error are failures that carry no token or name', async () => {
    for (const status of [401, 403, 500]) {
        const out = await deleteAppRepo({ pat: PAT, org: 'Org', repoName: NAME, fetchImpl: reply(status).fetchImpl });
        assert.deepEqual(out, { ok: false, status });
    }
    const out = await deleteAppRepo({ pat: PAT, org: 'Org', repoName: NAME, fetchImpl: async () => { throw new Error(`boom ${PAT}`); } });
    assert.deepEqual(out, { ok: false, status: 0 });
    assert.ok(!JSON.stringify(out).includes(PAT));
});

test('a bad name or a missing token never reaches GitHub', async () => {
    const f = reply(204);
    assert.deepEqual(await deleteAppRepo({ pat: PAT, org: 'Org', repoName: 'other-repo', fetchImpl: f.fetchImpl }), { ok: false, status: 400 });
    assert.deepEqual(await deleteAppRepo({ pat: '', org: 'Org', repoName: NAME, fetchImpl: f.fetchImpl }), { ok: false, status: 503 });
    assert.equal(f.calls.length, 0);
});
