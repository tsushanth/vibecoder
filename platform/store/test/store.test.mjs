import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scratchDb, masterKey, MIGRATION } from './helpers.mjs';
import { createPgStores } from '../pg.js';
import { createLimiter } from '../../vibe-proxy/limits.js';
import { createMeter, summarize } from '../../vibe-proxy/meter.js';

let db, skip, KEY, clock, stores;
const manifest = { connectors: { keyed: { host: 'api.example.com', paths: ['/v1/x'], methods: ['GET'], secret: { name: 'API_KEY', in: 'query', field: 'key' } } } };

before(async () => {
    db = await scratchDb();
    if (db.unavailable) { skip = `local Postgres unavailable: ${db.unavailable}`; return; }
    KEY = masterKey();
    let t = Date.UTC(2026, 9, 5, 12, 0, 10);
    clock = { now: () => t, advance: (ms) => { t += ms; } };
    stores = createPgStores({ pool: db.pool, masterKey: KEY, now: clock.now });
});
after(async () => { if (db && !db.unavailable) await db.cleanup(); });

const t = (name, fn) => test(name, async (c) => { if (skip) return c.skip(skip); await fn(c); });

t('the migration is idempotent', async () => {
    await db.pool.query(fs.readFileSync(MIGRATION, 'utf8'));
    await db.pool.query(fs.readFileSync(MIGRATION, 'utf8'));
});

t('appStore.get returns null for an unknown app', async () => {
    assert.equal(await stores.appStore.get('nope'), null);
});

t('upsertApp then appStore.get round-trips enabled, domains and manifest', async () => {
    await stores.upsertApp({ appId: 'app1', manifest, domains: ['shop.example.com'], enabled: true });
    assert.deepEqual(await stores.appStore.get('app1'), { enabled: true, domains: ['shop.example.com'], manifest });
});

t('upsertApp updates an existing app', async () => {
    await stores.upsertApp({ appId: 'app1', manifest, domains: [], enabled: false });
    assert.equal((await stores.appStore.get('app1')).enabled, false);
});

t('upsertApp rejects an invalid manifest or app id and stores nothing', async () => {
    await assert.rejects(() => stores.upsertApp({ appId: 'bad1', manifest: { connectors: { x: { host: '8.8.8.8', paths: ['/'], methods: ['GET'] } } } }), /manifest/i);
    await assert.rejects(() => stores.upsertApp({ appId: 'Bad App!', manifest }), /app id/i);
    assert.equal(await stores.appStore.get('bad1'), null);
});

t('createPgStores refuses a master key that is not 32 bytes of hex', () => {
    assert.throws(() => createPgStores({ pool: db.pool, masterKey: 'short' }), /master key/i);
    assert.throws(() => createPgStores({ pool: db.pool, masterKey: undefined }), /master key/i);
});

t('secrets round-trip, overwrite, and are isolated per app', async () => {
    await stores.upsertApp({ appId: 'app2', manifest, enabled: true });
    await stores.secretStore.set('app1', 'API_KEY', 'value-one');
    await stores.secretStore.set('app2', 'API_KEY', 'value-two');
    assert.equal(await stores.secretStore.get('app1', 'API_KEY'), 'value-one');
    assert.equal(await stores.secretStore.get('app2', 'API_KEY'), 'value-two');
    await stores.secretStore.set('app1', 'API_KEY', 'value-three');
    assert.equal(await stores.secretStore.get('app1', 'API_KEY'), 'value-three');
    assert.equal(await stores.secretStore.get('app1', 'MISSING_ONE'), undefined);
});

t('the database never holds a secret in plaintext', async () => {
    await stores.secretStore.set('app1', 'PLAIN_CHECK', 'PlaintextNeedle123456');
    const { rows } = await db.pool.query('select ciphertext, nonce from platform.app_secrets');
    for (const r of rows) assert.equal(Buffer.from(r.ciphertext).includes(Buffer.from('PlaintextNeedle123456')), false);
    const all = await db.pool.query("select row_to_json(s)::text as j from platform.app_secrets s");
    assert.equal(all.rows.some((r) => r.j.includes('PlaintextNeedle123456')), false);
});

t('a ciphertext copied to another app or name cannot be decrypted', async () => {
    await db.pool.query("insert into platform.app_secrets(app_id, name, ciphertext, nonce, key_version) select 'app2', 'STOLEN_ONE', ciphertext, nonce, key_version from platform.app_secrets where app_id='app1' and name='PLAIN_CHECK'");
    await assert.rejects(() => stores.secretStore.get('app2', 'STOLEN_ONE'), /secret_decrypt_failed/);
});

t('a different master key cannot decrypt', async () => {
    const other = createPgStores({ pool: db.pool, masterKey: masterKey(), now: clock.now });
    await assert.rejects(() => other.secretStore.get('app1', 'API_KEY'), /secret_decrypt_failed/);
});

t('secretStore.has reports presence and delete removes', async () => {
    assert.equal(await stores.secretStore.has('app1', 'API_KEY'), true);
    await stores.secretStore.delete('app1', 'API_KEY');
    assert.equal(await stores.secretStore.has('app1', 'API_KEY'), false);
    assert.equal(await stores.secretStore.get('app1', 'API_KEY'), undefined);
});

t('secretStore.list returns names and update times only, sorted, scoped to the app', async () => {
    await stores.upsertApp({ appId: 'listapp', manifest, enabled: true }); await stores.upsertApp({ appId: 'otherapp', manifest, enabled: true });
    await stores.secretStore.set('listapp', 'ZED_KEY', 'ListSecretValueZZZ111'); await stores.secretStore.set('listapp', 'ALPHA_KEY', 'ListSecretValueAAA222'); await stores.secretStore.set('otherapp', 'OTHER_KEY', 'OtherAppSecret333');
    const rows = await stores.secretStore.list('listapp');
    assert.deepEqual(rows.map((r) => r.name), ['ALPHA_KEY', 'ZED_KEY']);
    for (const r of rows) { assert.deepEqual(Object.keys(r).sort(), ['name', 'updatedAt']); assert.ok(r.updatedAt instanceof Date || typeof r.updatedAt === 'string'); }
    const text = JSON.stringify(rows);
    for (const bad of ['ListSecretValueZZZ111', 'ListSecretValueAAA222', 'OtherAppSecret333', 'OTHER_KEY']) assert.equal(text.includes(bad), false, bad);
    assert.deepEqual(await stores.secretStore.list('nobody'), []);
});

t('ensureApp creates a missing app with defaults and never changes an existing one', async () => {
    await stores.ensureApp({ appId: 'ensured1' });
    assert.deepEqual(await stores.appStore.get('ensured1'), { enabled: true, domains: [], manifest: null });
    await stores.upsertApp({ appId: 'ensured2', manifest, domains: ['keep.example.com'], enabled: false });
    await stores.ensureApp({ appId: 'ensured2' });
    assert.deepEqual(await stores.appStore.get('ensured2'), { enabled: false, domains: ['keep.example.com'], manifest });
    await stores.ensureApp({ appId: 'ensured1' });   // idempotent
    await assert.rejects(() => stores.ensureApp({ appId: 'Bad App!' }), /app id/i);
    assert.equal(await stores.appStore.get('Bad App!'), null);
});

t('setDomains replaces only the domains list and reports whether the app existed', async () => {
    await stores.upsertApp({ appId: 'doms1', manifest, domains: ['old.example.com'], enabled: false });
    assert.equal(await stores.setDomains('doms1', ['a.example.com', 'b.example.com']), true);
    assert.deepEqual(await stores.appStore.get('doms1'), { enabled: false, domains: ['a.example.com', 'b.example.com'], manifest });
    assert.equal(await stores.setDomains('doms1', []), true);
    assert.deepEqual((await stores.appStore.get('doms1')).domains, []);
    assert.equal(await stores.setDomains('no-such-app', ['x.example.com']), false);
});

t('setEnabled flips only the enabled flag, and reports whether the app existed', async () => {
    await stores.upsertApp({ appId: 'toggle1', manifest, domains: ['t.example.com'], enabled: true });
    assert.equal(await stores.setEnabled('toggle1', false), true);
    assert.deepEqual(await stores.appStore.get('toggle1'), { enabled: false, domains: ['t.example.com'], manifest });
    assert.equal(await stores.setEnabled('toggle1', true), true);
    assert.equal((await stores.appStore.get('toggle1')).enabled, true);
    assert.equal(await stores.setEnabled('no-such-app', false), false);
});

t('secret names must be UPPER_SNAKE and values non-empty and bounded', async () => {
    await assert.rejects(() => stores.secretStore.set('app1', 'bad name', 'v'), /^Error: invalid secret name$/);
    await assert.rejects(() => stores.secretStore.set('app1', 'GOOD_NAME', ''), /value/i);
    await assert.rejects(() => stores.secretStore.set('app1', 'GOOD_NAME', 'x'.repeat(5000)), /value/i);
});

t('limiter store: concurrent increments are atomic', async () => {
    const results = await Promise.all(Array.from({ length: 40 }, () => stores.limiterStore.incr('conc:test', 60)));
    assert.deepEqual([...results].sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i + 1));
    assert.equal(await stores.limiterStore.get('conc:test'), 40);
});

t('limiter store: counters expire and restart at 1', async () => {
    assert.equal(await stores.limiterStore.incr('exp:test', 60), 1);
    assert.equal(await stores.limiterStore.incr('exp:test', 60), 2);
    clock.advance(61_000);
    assert.equal(await stores.limiterStore.get('exp:test'), 0);
    assert.equal(await stores.limiterStore.incr('exp:test', 60), 1);
});

t('limiter store: add sums, set overwrites, missing reads as 0', async () => {
    assert.equal(await stores.limiterStore.get('sum:test'), 0);
    assert.equal(await stores.limiterStore.add('sum:test', 40, 3600), 40);
    assert.equal(await stores.limiterStore.add('sum:test', 2, 3600), 42);
    await stores.limiterStore.set('kill:app9', 1);
    assert.equal(await stores.limiterStore.get('kill:app9'), 1);
});

t('createLimiter on the Postgres store enforces the per-IP limit and the kill switch', async () => {
    const limiter = createLimiter({ store: stores.limiterStore, now: clock.now, perIpPerMin: 3, perAppPerMin: 100 });
    for (let i = 0; i < 3; i++) assert.equal((await limiter.check({ appId: 'lim1', ip: '1.1.1.1' })).ok, true);
    assert.equal((await limiter.check({ appId: 'lim1', ip: '1.1.1.1' })).reason, 'rate_limited_ip');
    await stores.limiterStore.set('kill:lim1', 1);
    assert.equal((await limiter.check({ appId: 'lim1', ip: '2.2.2.2' })).reason, 'app_disabled');
});

t('the usage sink stores events and usageSummary matches the in-memory summarize', async () => {
    const meter = createMeter({ sink: stores.usageSink, now: clock.now });
    await meter.record({ appId: 'app1', connector: 'nws', status: 200, outcome: 'ok', responseBytes: 10 });
    await meter.record({ appId: 'app1', connector: 'nws', status: 502, outcome: 'upstream_error', responseBytes: 5 });
    await meter.record({ appId: 'app1', connector: 'ai', status: 200, outcome: 'ok', responseBytes: 7 });
    assert.deepEqual(await stores.usageSummary('app1', '2026-10-05'), summarize([
        { connector: 'nws', status: 200, responseBytes: 10 }, { connector: 'nws', status: 502, responseBytes: 5 }, { connector: 'ai', status: 200, responseBytes: 7 }]));
});

t('row level security: a role with SELECT but no policy sees nothing, the proxy role sees rows', async () => {
    await db.pool.query("do $$ begin if not exists (select 1 from pg_roles where rolname='anon_sim') then create role anon_sim login; end if; end $$");
    await db.pool.query('grant usage on schema platform to anon_sim; grant select on all tables in schema platform to anon_sim');
    const anon = db.connFor({ user: 'anon_sim' });
    await db.pool.query("insert into platform.apps (app_id) values ('rls-app') on conflict do nothing");
    await db.pool.query("insert into platform.end_users (app_id, email) values ('rls-app', 'rls@example.com') on conflict do nothing");
    await db.pool.query("insert into platform.login_links (token_hash, app_id, email, expires_at) values ('\\x01', 'rls-app', 'rls@example.com', now() + interval '1 hour') on conflict do nothing");
    await db.pool.query("insert into platform.sessions (jti, app_id, user_id, expires_at) select 'rls-jti', app_id, id, now() + interval '1 day' from platform.end_users where app_id = 'rls-app' on conflict do nothing");
    for (const tbl of ['end_users', 'login_links', 'sessions']) assert.equal((await db.pool.query(`select count(*)::int as n from platform.${tbl}`)).rows[0].n, 1, `owner sees ${tbl}`);
    for (const tbl of ['apps', 'app_secrets', 'limiter_counters', 'usage_events', 'end_users', 'login_links', 'sessions']) assert.equal((await anon.query(`select count(*)::int as n from platform.${tbl}`)).rows[0].n, 0, tbl);
    await anon.end();
    const { rows } = await db.pool.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='platform' and relkind='r'");
    assert.ok(rows.length >= 8 && rows.every((r) => r.relrowsecurity), JSON.stringify(rows));
});
