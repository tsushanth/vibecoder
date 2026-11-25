import '../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { needsUserRow, rowFromAuthUser, createUserRowEnsurer } = await import('../../lib/ensureUserRow.js');

test('which requests need the row', () => {
    const yes = [['POST', '/api/projects/generate'], ['POST', '/api/projects/abc/fork'], ['POST', '/api/projects/save'], ['POST', '/API/Projects/abc/tweak'], ['POST', '/api/events/promo'], ['POST', '/api/deploy'], ['POST', '/api/domains'], ['POST', '/api/github/import'], ['POST', '/api/telegram/link'], ['GET', '/api/telegram/connect'], ['POST', '/api/auth/push-token']];
    const no = [['POST', '/api/auth/register'], ['DELETE', '/api/auth/account'], ['GET', '/api/projects/my'], ['OPTIONS', '/api/projects/generate'], ['POST', '/api/webhooks/revenuecat'], ['POST', '/api/telegram/webhook/x'], ['GET', '/api/health']];
    for (const [method, path] of yes) assert.equal(needsUserRow({ method, path }), true, `${method} ${path}`);
    for (const [method, path] of no) assert.equal(needsUserRow({ method, path }), false, `${method} ${path}`);
});

test('the row stays within the column limits and never stores blanks as names', () => {
    const row = rowFromAuthUser({ id: 'u', email: '', user_metadata: { full_name: 'x'.repeat(300), picture: 'https://p.test/a.png' } });
    assert.equal(row.display_name.length, 100);
    assert.equal(row.email, null);
    assert.equal(row.avatar_url, 'https://p.test/a.png');
    assert.equal(rowFromAuthUser({ id: 'u' }).display_name, 'Anonymous');
});

test('no verified user: nothing is written', async () => {
    const client = { from: () => { throw new Error('must not write'); } };
    assert.equal(await createUserRowEnsurer({ client, verify: async () => null })({}), 'unverified');
});

test('a lookup or database that hangs never holds the request past the timeout', async () => {
    const ensure = createUserRowEnsurer({ verify: () => new Promise(() => {}), timeoutMs: 20 });
    assert.equal(await ensure({}), 'failed');
});

test('an unexpected throw is swallowed', async () => {
    assert.equal(await createUserRowEnsurer({ verify: async () => { throw new Error('x'); } })({}), 'failed');
});
