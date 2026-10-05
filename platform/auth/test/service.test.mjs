import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratchDb, masterKey } from '../../store/test/helpers.mjs';
import { applyMigrations } from '../../store/migrate.js';
import { createPgStores } from '../../store/pg.js';
import { createAuthStore } from '../pgStore.js';
import { createAuthService } from '../service.js';
import { deriveAppKey } from '../keys.js';
import { signToken } from '../jwt.js';

let db, skip, stores, clock = Date.UTC(2026, 9, 5, 12), sent = [], mailFails = false;
const MASTER = masterKey();
let svc;
const mailer = { async send(m) { if (mailFails) throw new Error('smtp down'); sent.push(m); } };
const build = (limits) => createAuthService({ store: createAuthStore({ pool: db.pool }), limiterStore: stores.limiterStore, mailer, linkFor: (appId, token) => `https://${appId}.vibebuild.cc/?vibe_login=${token}`, masterKey: MASTER, now: () => clock, limits });
const tokenOf = (m) => new URL(m.link).searchParams.get('vibe_login');

before(async () => {
    db = await scratchDb({ migrate: false });
    if (db.unavailable) { skip = db.unavailable; return; }
    await applyMigrations(db.pool);
    stores = createPgStores({ pool: db.pool, masterKey: MASTER, now: () => clock });
    for (const a of ['app-a', 'app-b', 'app-c']) await stores.upsertApp({ appId: a, enabled: true, manifest: null });
    svc = build();
});
after(async () => { if (db && !db.unavailable) await db.cleanup(); });
const t = (n, f) => test(n, async (c) => { if (skip) return c.skip(skip); sent.length = 0; mailFails = false; await f(c); });
const signIn = async (appId, email, ip = '1.1.1.1') => {
    assert.equal((await svc.requestLink({ appId, email, ip })).ok, true);
    return svc.consumeLink({ appId, token: tokenOf(sent.at(-1)) });
};

t('request sends one email with a link, and the raw token is never stored', async () => {
    assert.deepEqual(await svc.requestLink({ appId: 'app-a', email: ' Ann@Example.com ', ip: '2.2.2.2' }), { ok: true });
    assert.equal(sent.length, 1); assert.equal(sent[0].to, 'ann@example.com'); assert.match(sent[0].link, /^https:\/\/app-a\.vibebuild\.cc\/\?vibe_login=/);
    const tok = tokenOf(sent[0]);
    const dump = await db.pool.query("select coalesce(string_agg(row_to_json(l)::text, ' '), '') d from platform.login_links l");
    assert.equal(dump.rows[0].d.includes(tok), false);
});

t('a link signs the user in once; a second use, another app and a forged token all fail', async () => {
    await svc.requestLink({ appId: 'app-a', email: 'bo@example.com', ip: '3.3.3.3' });
    const tok = tokenOf(sent[0]);
    assert.deepEqual(await svc.consumeLink({ appId: 'app-b', token: tok }), { ok: false, reason: 'invalid_link' });
    const r = await svc.consumeLink({ appId: 'app-a', token: tok });
    assert.equal(r.ok, true); assert.equal(r.user.email, 'bo@example.com'); assert.match(r.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.deepEqual(await svc.consumeLink({ appId: 'app-a', token: tok }), { ok: false, reason: 'invalid_link' });
    for (const bad of [undefined, '', 'short', 'x'.repeat(200), 5]) assert.equal((await svc.consumeLink({ appId: 'app-a', token: bad })).ok, false);
});

t('two simultaneous uses of one link: exactly one succeeds', async () => {
    await svc.requestLink({ appId: 'app-a', email: 'race@example.com', ip: '4.4.4.4' });
    const tok = tokenOf(sent[0]);
    const rs = await Promise.all([1, 2, 3, 4].map(() => svc.consumeLink({ appId: 'app-a', token: tok })));
    assert.equal(rs.filter((r) => r.ok).length, 1);
});

t('a link expires after 15 minutes', async () => {
    const start = clock;
    await svc.requestLink({ appId: 'app-a', email: 'late@example.com', ip: '5.5.5.5' });
    clock = start + 15 * 60_000 + 1;
    try { assert.equal((await svc.consumeLink({ appId: 'app-a', token: tokenOf(sent[0]) })).reason, 'invalid_link'); } finally { clock = start; }
    await svc.requestLink({ appId: 'app-a', email: 'late2@example.com', ip: '5.5.5.5' });
    clock = start + 14 * 60_000;
    try { assert.equal((await svc.consumeLink({ appId: 'app-a', token: tokenOf(sent.at(-1)) })).ok, true); } finally { clock = start; }
});

t('a session verifies, survives repeat use, and stops working after sign-out', async () => {
    const r = await signIn('app-a', 'cy@example.com');
    const v = await svc.verifySession({ appId: 'app-a', token: r.token });
    assert.deepEqual(v, { ok: true, user: { id: r.user.id, email: 'cy@example.com' } });
    assert.equal((await svc.verifySession({ appId: 'app-a', token: r.token })).ok, true);
    assert.equal((await svc.signOut({ appId: 'app-a', token: r.token })).ok, true);
    assert.deepEqual(await svc.verifySession({ appId: 'app-a', token: r.token }), { ok: false, reason: 'revoked' });
});

t('a session token is useless on another app', async () => {
    const r = await signIn('app-a', 'dee@example.com');
    const v = await svc.verifySession({ appId: 'app-b', token: r.token });
    assert.equal(v.ok, false); assert.equal(v.reason, 'bad_signature');
    assert.equal((await svc.signOut({ appId: 'app-b', token: r.token })).ok, false);
    assert.equal((await svc.verifySession({ appId: 'app-a', token: r.token })).ok, true);
});

t('a session expires after 30 days', async () => {
    const start = clock; const r = await signIn('app-a', 'eve@example.com');
    try {
        clock = start + 30 * 24 * 3600_000 - 1000; assert.equal((await svc.verifySession({ appId: 'app-a', token: r.token })).ok, true);
        clock = start + 30 * 24 * 3600_000 + 1000; assert.equal((await svc.verifySession({ appId: 'app-a', token: r.token })).reason, 'expired');
    } finally { clock = start; }
});

t('the same email is a separate user in each app', async () => {
    const a = await signIn('app-a', 'same@example.com'); const b = await signIn('app-b', 'same@example.com');
    assert.notEqual(a.user.id, b.user.id);
    const again = await signIn('app-a', 'SAME@example.com');
    assert.equal(again.user.id, a.user.id);
});

t('invalid emails are refused without sending anything', async () => {
    for (const e of ['', 'nope', 'a@b', 'a b@c.com', '<x>@c.com', 'a@c..com', 'a@-c.com', 'x'.repeat(300) + '@c.com', undefined, 42, 'a@b.com, c@d.com'])
        assert.deepEqual(await svc.requestLink({ appId: 'app-a', email: e, ip: '9.9.9.9' }), { ok: false, reason: 'invalid_email' }, String(e));
    assert.equal(sent.length, 0);
});

t('limits: per email per hour, per IP per hour, per app per day', async () => {
    const s = build({ perEmailPerHour: 2, perIpPerHour: 100, perAppPerDay: 1000 });
    const r = []; for (let i = 0; i < 3; i++) r.push((await s.requestLink({ appId: 'app-a', email: 'lim1@example.com', ip: '6.6.6.6' })).ok);
    assert.deepEqual(r, [true, true, false]);
    assert.equal((await s.requestLink({ appId: 'app-a', email: 'lim2@example.com', ip: '6.6.6.6' })).ok, true);
    const s2 = build({ perEmailPerHour: 100, perIpPerHour: 2, perAppPerDay: 1000 });
    const r2 = []; for (let i = 0; i < 3; i++) r2.push((await s2.requestLink({ appId: 'app-a', email: `ip${i}@example.com`, ip: '7.7.7.7' })).ok);
    assert.deepEqual(r2, [true, true, false]);
    const s3 = build({ perEmailPerHour: 100, perIpPerHour: 100, perAppPerDay: 2 });
    const r3 = []; for (let i = 0; i < 3; i++) r3.push((await s3.requestLink({ appId: 'app-c', email: `day${i}@example.com`, ip: `8.8.8.${i}` })).ok);
    assert.deepEqual(r3, [true, true, false]);
});

t('a mail failure is reported as send_failed and leaks nothing', async () => {
    mailFails = true;
    const r = await svc.requestLink({ appId: 'app-a', email: 'fail@example.com', ip: '10.0.0.1' });
    assert.deepEqual(r, { ok: false, reason: 'send_failed' });
});

t('purgeExpired removes old links and sessions only', async () => {
    const store = createAuthStore({ pool: db.pool });
    await store.purgeExpired({ now: clock + 3 * 86_400_000 });
    assert.equal((await db.pool.query('select count(*)::int n from platform.login_links')).rows[0].n, 0);
    await store.purgeExpired({ now: clock });
});

t('a correctly signed token that pairs one session with another user is refused', async () => {
    const a = await signIn('app-a', 'pair-a@example.com'); const b = await signIn('app-a', 'pair-b@example.com');
    const jtiA = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url')).jti;
    const forged = signToken({ key: deriveAppKey(MASTER, 'app-a'), appId: 'app-a', sub: b.user.id, jti: jtiA, now: clock });
    assert.deepEqual(await svc.verifySession({ appId: 'app-a', token: forged }), { ok: false, reason: 'revoked' });
});
