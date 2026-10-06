// LAUNCH GATE 1: the cross-tenant suite. Boots the real proxy (startServer) against a scratch Postgres through a restricted login and
// attacks every route family, in both directions between two tenants, with every kind of bad credential. See gate/matrix.mjs for the table.
// Needs a local Postgres (PGHOST/PGPORT); skips when none is reachable.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startPlatform, ADMIN_T, BASE_DOMAIN, R2ENV } from '../harness.mjs';
import { seedTenant, snapshot, TABLES, sha, addForeignReferenceOrder } from '../fixture.mjs';
import { buildOps, ADMIN_NEAR_MISSES } from '../matrix.mjs';
import { signToken } from '../../auth/jwt.js';
import { deriveAppKey } from '../../auth/keys.js';
import { createDataExecutor, isSafeStatement } from '../../data/executor.js';
import { ROUTE } from '../../proxy-app/server.js';
import { AUTH_OPS } from '../../auth/routes.js';
import { STORAGE_OPS } from '../../storage/routes.js';
import { PAY_OPS } from '../../pay/http.js';
import { NOTIFY_OPS } from '../../notify/http.js';
import { ADMIN_SUBS } from '../../proxy-app/admin.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const logs = [];
let P, A, B, skip, p, linksInjected = [];
const stats = { cells: 0, skipped: [], byDirection: {} };

before(async () => {
    P = await startPlatform({ log: (l) => logs.push(l) });
    if (P.unavailable) { skip = P.unavailable; return; }
    p = { stripe: P.stripeCalls, upstream: P.upstreamCalls, r2: P.r2calls, MK: P.MK };
    A = await seedTenant(P, 'app-a', 'A');
    B = await seedTenant(P, 'app-b', 'B');
    // each tenant's creator records an order naming the OTHER tenant's user as the buyer: the other tenant's user must never see it
    await addForeignReferenceOrder(P, A, B.u1.id); await addForeignReferenceOrder(P, B, A.u1.id);
    P.r2calls.length = 0; P.stripeCalls.length = 0; P.upstreamCalls.length = 0; P.mails.length = 0; logs.length = 0;
});
after(async () => { if (P && !P.unavailable) await P.stop(); });
const t = (name, fn) => test(name, async (c) => { if (skip) return c.skip(skip); await fn(c); });

// ---------- credentials ----------
const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const forge = ({ key, appId, sub, jti, now, ttlSec }) => signToken({ key, appId, sub, jti, now, ttlSec });
function swapClaim(token, appId) { const [h, pl, s] = token.split('.'); const c = JSON.parse(Buffer.from(pl, 'base64url')); c.app_id = appId; return `${h}.${b64u(c)}.${s}`; }
function algNone(claims) { return `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u(claims)}.`; }

/** Every credential an attacker (a user of `att`) might present against `vic`. kind: anon | own | bad. */
function identities(att, vic) {
    const now = Math.floor(Date.now() / 1000);
    const vclaims = { app_id: vic.app, sub: vic.u1.id, jti: vic.u1.jti, iat: now, exp: now + 3600 };
    const vkey = deriveAppKey(P.MK, vic.app);
    const bad = (name, token, app = vic.app, extra = {}) => ({ name, kind: 'bad', app, token, ...extra });
    return [
        { name: 'anonymous', kind: 'anon', app: vic.app, token: null },
        { name: 'own_user_on_own_app', kind: 'own', app: att.app, token: att.u1.token },
        bad('own_token_on_victim_app', att.u1.token),
        bad('claim_swapped_to_victim_app', swapClaim(att.u1.token, vic.app)),
        bad('wrong_key', forge({ key: randomBytes(32), appId: vic.app, sub: vic.u1.id, jti: vic.u1.jti })),
        bad('alg_none', algNone(vclaims)),
        bad('expired_signed_with_victim_key', forge({ key: vkey, appId: vic.app, sub: vic.u1.id, jti: vic.u1.jti, now: Date.now() - 90 * 86400_000, ttlSec: 3600 })),
        bad('key_derived_for_attacker_app', forge({ key: deriveAppKey(P.MK, att.app), appId: vic.app, sub: vic.u1.id, jti: vic.u1.jti })),
        bad('revoked_session', att.u3.token),
        bad('session_row_deleted', att.u4.token),
        bad('revoked_session_on_own_app', att.u3.token, att.app, { kind: 'badown' }),
        bad('session_row_deleted_on_own_app', att.u4.token, att.app, { kind: 'badown' }),
        bad('leaked_key_unknown_jti', forge({ key: vkey, appId: vic.app, sub: vic.u1.id, jti: randomUUID() })),
        bad('leaked_key_claim_for_attacker_app', forge({ key: vkey, appId: att.app, sub: vic.u1.id, jti: vic.u1.jti })),
        bad('leaked_key_attacker_session_jti', forge({ key: vkey, appId: vic.app, sub: att.u1.id, jti: att.u1.jti })),
        bad('leaked_key_sub_mismatch', forge({ key: vkey, appId: vic.app, sub: vic.u2.id, jti: vic.u1.jti })),
        bad('garbage', 'not.a.jwt'),
        bad('oversized', 'x'.repeat(5000)),
        ...ADMIN_NEAR_MISSES(ADMIN_T).map(([name, tok, scheme]) => bad(name, tok, vic.app, { adminOnly: true, authHeader: scheme === false ? tok : `${scheme === 'bearer' ? 'bearer' : 'Bearer'} ${tok}` })),
    ];
}

async function mintLink(app) {
    const token = randomBytes(32).toString('base64url');
    const h = sha(token);
    await A.authStore.addLink({ tokenHash: h, appId: app, email: `link-${randomBytes(3).toString('hex')}@probe.test`, expiresAt: Date.now() + 600_000 });
    linksInjected.push(h);
    return token;
}

// ---------- the matrix ----------
const OPS = buildOps();
function forbiddenFor(att, vic, allowPublic) {
    return [...vic.forbidden().filter(([, , pub]) => !(allowPublic && pub)), ['att.stripeKey', att.stripeKey], ['att.whSecret', att.whSecret], ['att.apiKey', att.apiKey], ['admin', ADMIN_T], ['master', P.MK], ['r2secret', R2ENV.R2_SECRET_ACCESS_KEY], ['openrouter', 'sk-or-v1-FAKE'], ['resend', 're_testkey12345']];
}
const scan = (text, list) => list.filter(([, s]) => s && text.includes(s)).map(([l]) => l);

async function runCell(att, vic, op, id) {
    // a bad credential presented on the attacker's own app behaves like the own caller for routes that ignore it, and is refused where a session is required
    const exp = op.exp[id.kind] ?? (op.exp.bad.status === 401 && op.exp.bad.error === 'unauthorized' ? op.exp.bad : { ...op.exp.own, check: undefined });
    const ctx = { att, vic, id, kind: id.kind, p, onAtt: id.app === att.app };
    if (op.needsLink) ctx.link = await mintLink(ctx.onAtt ? vic.app : att.app);
    let token = id.token;
    if (op.fresh && id.kind === 'own') token = (await P.signIn(att.app, `fresh-${randomBytes(4).toString('hex')}@probe.test`)).token;
    const rq = op.build(ctx);
    const before = { mails: P.mails.length, r2: P.r2calls.length, stripe: P.stripeCalls.length, up: P.upstreamCalls.length };
    const res = await P.call(rq.path, { method: rq.method || 'POST', body: rq.body, token: id.authHeader ? undefined : token, headers: { ...(rq.headers || {}), ...(id.authHeader ? { authorization: id.authHeader } : {}) } });
    const why = [];
    if (res.status !== exp.status) why.push(`status ${res.status}, expected ${exp.status}`);
    if (exp.error && res.json?.error !== exp.error) why.push(`error ${JSON.stringify(res.json?.error)}, expected ${exp.error}`);
    const found = scan(res.text + JSON.stringify(res.headers), forbiddenFor(att, vic, exp.allowPublic));
    if (found.length) why.push(`LEAK of ${found.join(', ')}`);
    const dm = P.mails.slice(before.mails);
    for (const m of dm) for (const to of m.to || []) if ([...vic.canary.emails].includes(to)) why.push('mail sent to a victim address');
    if (exp.mail && !exp.mail(dm, ctx)) why.push('unexpected mail recipients');
    if (exp.r2 !== undefined && P.r2calls.length - before.r2 !== exp.r2) why.push(`r2 calls ${P.r2calls.length - before.r2}, expected ${exp.r2}`);
    if (exp.stripe !== undefined && P.stripeCalls.length - before.stripe !== exp.stripe) why.push(`stripe calls ${P.stripeCalls.length - before.stripe}, expected ${exp.stripe}`);
    if (exp.upstream !== undefined && P.upstreamCalls.length - before.up !== exp.upstream) why.push(`upstream calls ${P.upstreamCalls.length - before.up}, expected ${exp.upstream}`);
    if (exp.check) { let ok = false; try { ok = exp.check(res, ctx); } catch { ok = false; } if (!ok) why.push('response check failed'); }
    return why.length ? `${op.id} x ${id.name}: ${why.join('; ')} (body: ${res.text.slice(0, 160).replace(/\s+/g, ' ')})` : null;
}

async function runDirection(att, vic) {
    const ids = identities(att, vic);
    const failures = [];
    let n = 0;
    const before = await snapshot(P, vic);
    for (const op of OPS) {
        const isAdmin = op.route.startsWith('admin');
        for (const id of ids) {
            if (id.adminOnly && !isAdmin) continue;
            if (op.skip?.[id.name]) { stats.skipped.push(`${att.tag}->${vic.tag} ${op.id} x ${id.name}: ${op.skip[id.name]}`); continue; }
            n++;
            const f = await runCell(att, vic, op, id);
            if (f) failures.push(f);
            if (process.env.GATE_DEBUG && !(await P.db.pool.query('select to_regclass($1) t', [`"${vic.schema}".t_owner`])).rows[0].t) { console.log(`DESTROYED by ${op.id} x ${id.name}`); process.exit(3); }
        }
    }
    const after_ = await snapshot(P, vic);
    stats.cells += n; stats.byDirection[`${att.tag}->${vic.tag}`] = n;
    return { failures, n, unchanged: before === after_ };
}

for (const [att, vic] of [['A', 'B'], ['B', 'A']]) {
    t(`matrix: ${att} attacks ${vic}: every route family x every credential`, async () => {
        const r = await runDirection(att === 'A' ? A : B, vic === 'A' ? A : B);
        console.log(`# cross-tenant matrix ${att}->${vic}: ${r.n} cells`);
        assert.deepEqual(r.failures, [], `${r.failures.length} cell(s) failed`);
        assert.equal(r.unchanged, true, `the victim tenant's stored data changed during the attack`);
    });
}

t('matrix size is large and nothing was silently dropped', () => {
    assert.ok(stats.cells >= 1500, `only ${stats.cells} cells ran`);
    assert.ok(OPS.length >= 150);
    for (const s of stats.skipped.slice(0, 3)) assert.match(s, /: .{10,}/);
    console.log(`# cross-tenant matrix total: ${stats.cells} cells, ${OPS.length} operations, ${stats.skipped.length} cells skipped with a stated reason`);
});

// ---------- detector self-test and positive controls: the matrix must not pass because the detector or the routes are dead ----------
t('positive controls: legitimate callers get their own data, and the leak detector sees it', async () => {
    const me = await P.call(`/${B.app}/auth/me`, { token: B.u1.token });
    assert.equal(me.status, 200);
    assert.deepEqual(scan(me.text, B.forbidden()).sort(), ['email', 'u1.id']);
    const own = await P.call(`/${B.app}/db`, { token: B.u1.token, body: { op: 'select', table: 't_owner' } });
    assert.equal(own.status, 200); assert.ok(scan(own.text, B.forbidden()).includes('value'));
    const files = await P.call(`/${B.app}/storage/list`, { token: B.u1.token, body: {} });
    assert.equal(files.status, 200); assert.ok(scan(files.text, B.forbidden()).includes('id'));
    const url = await P.call(`/${B.app}/storage/url`, { token: B.u1.token, body: { id: B.filePriv.id } });
    assert.equal(url.status, 200); assert.match(url.json.url, /X-Amz-Signature=/);
    const orders = await P.call(`/${B.app}/pay/orders`, { token: B.u1.token, body: {} });
    assert.equal(orders.status, 200); assert.equal(orders.json.orders.length, 1);
    const adminOk = await P.call(`/admin/apps/${B.app}`, { method: 'GET', token: ADMIN_T });
    assert.equal(adminOk.status, 200); assert.equal(scan(adminOk.text, [['stripe', B.stripeKey], ['wh', B.whSecret], ['api', B.apiKey]]).length, 0);
    const sec = await P.call(`/admin/apps/${B.app}/secrets`, { method: 'GET', token: ADMIN_T });
    assert.equal(sec.status, 200); assert.equal(scan(sec.text, [['stripe', B.stripeKey], ['wh', B.whSecret], ['api', B.apiKey]]).length, 0, 'the admin API never returns secret values');
    assert.equal((await P.call(`/${B.app}/auth/me`, { token: B.u3.token })).status, 401, 'revoked fixture token really is revoked');
    assert.equal((await P.call(`/${B.app}/auth/me`, { token: B.u4.token })).status, 401, 'deleted-session fixture token really is dead');
    assert.equal((await P.call(`/${A.app}/auth/me`, { token: B.u1.token })).status, 401);
});

t('injected links for the other app are still unused after the matrix', async () => {
    const { rows } = await P.db.pool.query('select count(*)::int n from platform.login_links where token_hash = any($1::bytea[]) and used_at is not null', [linksInjected]);
    assert.equal(rows[0].n, 0); assert.ok(linksInjected.length >= 10);
});

t('logs captured during the whole matrix contain no tenant value, id, email, token or secret', () => {
    assert.ok(logs.length > 1500, `only ${logs.length} log lines`);
    console.log(`# captured log lines: ${logs.length}`);
    const all = [...A.forbidden(), ...B.forbidden(), ['admin', ADMIN_T], ['master', P.MK], ['r2secret', R2ENV.R2_SECRET_ACCESS_KEY]].filter(([, s]) => s);
    const text = logs.join('\n');
    assert.deepEqual(scan(text, all), []);
    for (const l of logs.slice(0, 2000)) { const o = JSON.parse(l); assert.ok(['request', 'error'].includes(o.event)); }
});

// ---------- CORS ----------
function gatedRoutes(vic) {
    return [`db`, `ai`, `api`, ...AUTH_OPS.map((o) => `auth/${o}`), ...STORAGE_OPS.map((o) => `storage/${o}`), 'notify/me', 'pay/checkout', 'pay/orders'].map((r) => `/${vic.app}/${r}`);
}
for (const [att, vic] of [['A', 'B'], ['B', 'A']]) {
    t(`CORS: a preflight or request from ${att}'s origins to ${vic}'s routes never gets an allow-origin header`, async () => {
        const a = att === 'A' ? A : B, v = vic === 'A' ? A : B;
        const origins = [`https://${a.app}.${BASE_DOMAIN}`, `https://${a.domain}`, `https://${v.app}.${BASE_DOMAIN}.evil.example`, `http://${v.app}.${BASE_DOMAIN}`, `https://evil${v.app}.${BASE_DOMAIN}`, 'null', 'https://', `https://${v.app}.${BASE_DOMAIN}@evil.example`];
        const fails = []; let n = 0;
        for (const path of gatedRoutes(v)) for (const origin of origins) for (const method of ['OPTIONS', 'POST']) {
            n++;
            const r = await P.call(path, { method, headers: { origin, 'access-control-request-method': 'POST', 'content-type': 'application/json' }, body: method === 'POST' ? {} : undefined, token: a.u1.token });
            if (r.status !== 403 || r.json?.error !== 'origin_not_allowed' || r.headers['access-control-allow-origin'] !== undefined) fails.push(`${method} ${path} from ${origin}: ${r.status} ${r.headers['access-control-allow-origin'] ?? ''}`);
            if (scan(r.text, forbiddenFor(a, v, false)).length) fails.push(`LEAK ${path}`);
        }
        // routes with no browser CORS: webhook (called by Stripe) and unsubscribe (an email link)
        for (const origin of origins) {
            const w = await P.call(`/${v.app}/pay/webhook`, { method: 'OPTIONS', headers: { origin } });
            if (w.status !== 405 || w.headers['access-control-allow-origin'] !== undefined) fails.push(`webhook preflight ${origin}: ${w.status}`);
            const w2 = await P.call(`/${v.app}/pay/webhook`, { body: '{}', headers: { origin } }); n += 2;
            if (w2.status !== 400 || w2.headers['access-control-allow-origin'] !== undefined) fails.push(`webhook post ${origin}: ${w2.status}`);
            const u = await P.call(`/${v.app}/notify/unsubscribe?t=x`, { method: 'OPTIONS', headers: { origin } }); n++;
            if (u.status !== 405 || u.headers['access-control-allow-origin'] !== undefined) fails.push(`unsubscribe preflight ${origin}: ${u.status}`);
        }
        console.log(`# CORS ${att}->${vic}: ${n} cells`); stats.cells += n;
        assert.deepEqual(fails, []);
        // positive control: the victim's own origins do pass
        for (const origin of [`https://${v.app}.${BASE_DOMAIN}`, `https://${v.domain}`]) {
            const ok = await P.call(`/${v.app}/db`, { method: 'OPTIONS', headers: { origin } });
            assert.equal(ok.status, 204); assert.equal(ok.headers['access-control-allow-origin'], origin);
        }
    });
}

// ---------- URL and routing tricks ----------
function rawHttp(pathAndQuery, { method = 'POST', headers = {}, body = '{}' } = {}) {
    return new Promise((resolve, reject) => {
        const s = net.connect(P.srv.port, '127.0.0.1');
        const h = { host: 'localhost', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), connection: 'close', 'fly-client-ip': P.nextIp(), ...headers };
        s.write(`${method} ${pathAndQuery} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${body}`);
        let buf = ''; s.on('data', (d) => { buf += d; }); s.on('end', () => resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(buf)?.[1]), text: buf })); s.on('error', reject);
        setTimeout(() => { s.destroy(); reject(new Error('raw request timed out')); }, 8000);
    });
}
for (const [att, vic] of [['A', 'B'], ['B', 'A']]) {
    t(`routing tricks: ${att}'s token never reaches ${vic}'s data through path, query, header or encoding tricks`, async () => {
        const a = att === 'A' ? A : B, v = vic === 'A' ? A : B;
        const body = JSON.stringify({ op: 'select', table: 't_owner' });
        const auth = { authorization: `Bearer ${a.u1.token}` };
        const fails = [];
        const cases = [
            [`/${a.app}/db?app=${v.app}&appId=${v.app}&schema=${v.schema}&app_id=${v.app}`, {}, [200]],
            [`/${a.app}/db`, { 'x-app-id': v.app, 'x-vibe-app': v.app, 'x-forwarded-host': `${v.app}.${BASE_DOMAIN}`, 'x-forwarded-for': '1.2.3.4', origin: `https://${a.app}.${BASE_DOMAIN}` }, [200]],
            [`/${a.app}/db`, { host: `${v.app}.${BASE_DOMAIN}` }, [200]],
            [`/${v.app.toUpperCase()}/db`, {}, [404]], [`/${v.app}/db/`, {}, [404]], [`/${v.app}/db%00`, {}, [404]], [`//${v.app}/db`, {}, [404]], [`/${v.app}%2fdb`, {}, [404]],
            [`/${a.app}/db/%2e%2e/${v.app}/db`, {}, [404, 401]], [`/${a.app}%2f..%2f${v.app}/db`, {}, [404]], [`/${v.app}/..%2fdb`, {}, [404]], [`/${v.app}/db;x=1`, {}, [404]], [`/${v.app}/db#x`, {}, [401]],
            [`/${v.app}/db`, {}, [401]], [`/${a.app}/storage/../db`, {}, [404, 200]], [`/${v.app}/auth/me/../../db`, {}, [404, 401]],
            [`/__proto__/db`, {}, [404]], [`/constructor/db`, {}, [404]], ['/' + 'a'.repeat(64) + '/db', {}, [404]], ['/-' + v.app + '/db', {}, [404]], ['/ ' + v.app + '/db', {}, [400]],
        ];
        for (const [path, extra, ok] of cases) {
            let r; try { r = await rawHttp(path, { headers: { ...auth, ...extra }, body }); } catch (e) { fails.push(`${path}: ${e.message}`); continue; }
            if (!ok.includes(r.status)) fails.push(`${path}: ${r.status}`);
            if (scan(r.text, forbiddenFor(a, v, false)).length) fails.push(`LEAK ${path}`);
        }
        stats.cells += cases.length; console.log(`# routing tricks ${att}->${vic}: ${cases.length} cells`);
        assert.deepEqual(fails, []);
    });
}

// ---------- state: attackers must not have changed anything either side owns ----------
t('victim state is unchanged for every platform table after both directions (secrets, manifest, domains, enabled flag, jobs, sessions)', async () => {
    for (const T of [A, B]) {
        assert.equal(await P.stores.secretStore.get(T.app, 'STRIPE_SECRET_KEY'), T.stripeKey);
        assert.equal(await P.stores.secretStore.get(T.app, 'STRIPE_WEBHOOK_SECRET'), T.whSecret);
        assert.equal(await P.stores.secretStore.get(T.app, `API_KEY_${T.tag}`), T.apiKey);
        const app = await P.stores.appStore.get(T.app);
        assert.equal(app.enabled, true); assert.deepEqual(app.domains, [T.domain]);
        assert.equal((await P.call(`/${T.app}/auth/me`, { token: T.u1.token })).status, 200, 'the victim user session survived');
    }
    const aSecrets = (await P.stores.secretStore.list('app-a')).map((s) => s.name).sort();
    assert.deepEqual(aSecrets, ['API_KEY_A', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
    const optouts = (await P.db.pool.query('select app_id, user_id from platform.notify_optouts order by 1, 2')).rows;
    assert.deepEqual(optouts.map((r) => r.user_id).sort(), [A.u2.id, B.u2.id].sort(), 'no one was opted out or back in by an attacker');
});

// ---------- database level ----------
async function asRole(role, fn) {
    const c = await P.proxyPool.connect();
    try { await c.query('begin'); await c.query(`set local role "${role}"`); return await fn(c); } finally { await c.query('rollback').catch(() => {}); c.release(); }
}
const denied = async (c, sql, params = []) => { await c.query('savepoint s'); try { await c.query(sql, params); await c.query('rollback to savepoint s'); return false; } catch (e) { await c.query('rollback to savepoint s'); return e.code === '42501' || /permission denied|must be owner|no schema has been selected/.test(e.message); } };

for (const [att, vic] of [['A', 'B'], ['B', 'A']]) {
    t(`database: the ${att} role cannot read, write, alter or create anything in ${vic}'s schema, in platform.*, or anywhere shared`, async () => {
        const a = att === 'A' ? A : B, v = vic === 'A' ? A : B;
        const platformTables = (await P.db.pool.query("select table_name from information_schema.tables where table_schema = 'platform' order by 1")).rows.map((r) => r.table_name);
        assert.ok(platformTables.length >= 10, 'platform tables found');
        const results = await asRole(a.role, async (c) => {
            const out = [];
            const attempt = async (label, sql, params) => out.push([label, await denied(c, sql, params)]);
            for (const tb of TABLES) {
                await attempt(`select ${v.schema}.${tb}`, `select * from "${v.schema}"."${tb}"`);
                await attempt(`insert ${v.schema}.${tb}`, `insert into "${v.schema}"."${tb}" (v) values ('x')`);
                await attempt(`update ${v.schema}.${tb}`, `update "${v.schema}"."${tb}" set v = 'x'`);
                await attempt(`delete ${v.schema}.${tb}`, `delete from "${v.schema}"."${tb}"`);
                await attempt(`truncate ${v.schema}.${tb}`, `truncate "${v.schema}"."${tb}"`);
                await attempt(`drop ${v.schema}.${tb}`, `drop table "${v.schema}"."${tb}"`);
                await attempt(`alter ${v.schema}.${tb}`, `alter table "${v.schema}"."${tb}" add column z int`);
            }
            await attempt('create table in victim schema', `create table "${v.schema}".evil (a int)`);
            await attempt('drop victim schema', `drop schema "${v.schema}" cascade`);
            await attempt('create schema', 'create schema evil');
            await attempt('create table in platform', 'create table platform.evil (a int)');
            await attempt('create table in public', 'create table public.evil (a int)');
            for (const tb of platformTables) {
                await attempt(`select platform.${tb}`, `select * from platform.${tb}`);
                await attempt(`delete platform.${tb}`, `delete from platform.${tb}`);
                await attempt(`insert platform.${tb} default`, `insert into platform.${tb} default values`);
            }
            await attempt('provision another app', 'select * from platform.provision_app_db($1)', [v.app]);
            await attempt('create role', 'create role evil login');
            await attempt('alter victim role', `alter role "${v.role}" with superuser`);
            await attempt('read pg_authid', 'select rolpassword from pg_catalog.pg_authid');
            await attempt('read pg_shadow', 'select passwd from pg_catalog.pg_shadow');
            await attempt('copy program', "copy (select 1) to program 'id'");
            await attempt('read server file', "select pg_read_file('/etc/passwd')");
            await attempt('large object import', "select lo_import('/etc/passwd')");
            return out;
        });
        assert.deepEqual(results.filter(([, ok]) => !ok), [], 'every attempt must be denied by the database itself');
        // and the data really is intact
        assert.equal((await P.db.pool.query(`select count(*)::int n from "${v.schema}"."t_owner"`)).rows[0].n >= 2, true);
    });
}

t('database: the proxy login itself has no direct access to any tenant schema (it must switch role first)', async () => {
    for (const T of [A, B]) {
        for (const tb of TABLES) await assert.rejects(() => P.proxyPool.query(`select * from "${T.schema}"."${tb}"`), /permission denied/);
        await assert.rejects(() => P.proxyPool.query(`create table "${T.schema}".evil (a int)`), /permission denied/);
    }
});

t('database: each tenant role sees only its own schema even through search_path, current_schemas and the catalog', async () => {
    for (const [mine, theirs] of [[A, B], [B, A]]) {
        await asRole(mine.role, async (c) => {
            await c.query(`set local search_path = "${mine.schema}"`);
            assert.equal((await c.query('select current_user u')).rows[0].u, mine.role);
            assert.deepEqual((await c.query('select table_name from information_schema.tables where table_schema = $1 order by 1', [theirs.schema])).rows, [], 'the other schema is invisible in information_schema');
            const r = await c.query("select tablename from pg_tables where schemaname = $1", [theirs.schema]); // pg_tables is readable; that is names only
            assert.ok(r.rows.length <= TABLES.length);
            assert.equal(await denied(c, `select * from ${theirs.schema}.t_owner`), true);
        });
    }
});

t('executor: statements that could switch role, reach another tenant or run several statements are refused before the database', async () => {
    const ex = createDataExecutor({ pool: P.proxyPool });
    const attempts = [
        `set role "${B.role}"`, `SET ROLE "${B.role}"`, 'SeT   LoCaL  rOlE x', 'reset role', 'select 1; set role x', "select set_config('role','x',true)", 'select current_setting($1)', 'select session_user', 'select pg_sleep(1)',
        'select 1 /* x */', 'select 1 -- x', "select 'x'", 'select\nset_config($1,$2,true)', 'with x as (select 1) select * from x', 'copy t_owner to stdout', 'do $$ begin end $$', 'call x()', 'truncate "t_owner"', 'grant all on "t_owner" to public',
        'select lo_import($1)', 'select nextval($1)', 'select dblink($1,$2)', 'prepare x as select 1', 'listen x', 'notify x', 'vacuum', 'analyze', 'select authorization',
        'select "role" from "t_owner" where role = 1', // bare identifier role is refused even though a quoted column named role is fine
    ];
    console.log(`# executor refusals: ${attempts.length} statements`);
    for (const text of attempts) {
        const r = await ex.run(A.app, { text, values: text.includes('$') ? ['x', 'y'] : [] });
        assert.deepEqual(r, { ok: false, status: 500, code: 'bad_query' }, text);
        assert.equal(isSafeStatement(text), false, text);
    }
    // after all of that the connection pool is clean: the next statement runs as the right role in the right schema
    const who = await ex.run(B.app, { text: 'select current_user as u, current_schema() as s', values: [] });
    assert.deepEqual([who.rows[0].u, who.rows[0].s], [B.role, B.schema]);
    const whoA = await ex.run(A.app, { text: 'select current_user as u, current_schema() as s', values: [] });
    assert.deepEqual([whoA.rows[0].u, whoA.rows[0].s], [A.role, A.schema]);
    const cross = await ex.run(A.app, { text: `select * from "${B.schema}"."t_owner"`, values: [] });
    assert.deepEqual([cross.ok, cross.code], [false, 'db_error']);
});

t('provisioning: app role and schema names are fixed by the database from the app id and cannot be chosen by a caller', async () => {
    const { rows } = await P.db.pool.query('select app_id, role_name, schema_name from platform.app_dbs order by 1');
    assert.equal(new Set(rows.map((r) => r.role_name)).size, rows.length); assert.equal(new Set(rows.map((r) => r.schema_name)).size, rows.length);
    for (const r of rows) { assert.match(r.role_name, /^appr_[0-9a-f]{20}$/); assert.match(r.schema_name, /^apps_[0-9a-f]{20}$/); }
    for (const bad of ["x'; drop schema platform;--", 'APP', '', '../app-a', 'app-a ']) await assert.rejects(() => P.proxyPool.query('select * from platform.provision_app_db($1)', [bad]), /invalid app id|unknown app/);
});

// ---------- coverage: a route nobody wrote a decision for fails the gate ----------
const covered = () => new Set(OPS.map((o) => o.route));
function expandAlternatives(src) {
    const m = /^\^\\\/\(\[a-z0-9\]\[a-z0-9-\]\{0,62\}\)\\\/\((.*)\)\$$/.exec(src);
    assert.ok(m, 'ROUTE has the expected shape');
    // split on top-level |
    const alts = []; let depth = 0, cur = '';
    for (const ch of m[1]) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === '|' && depth === 0) { alts.push(cur); cur = ''; } else cur += ch; }
    alts.push(cur);
    return alts.flatMap((a) => { const g = /^([a-z]+)\\\/\(\?:(.*)\)$/.exec(a); return g ? g[2].split('|').map((o) => `${g[1]}/${o}`) : [a]; });
}
t('coverage: every route in the server ROUTE regexp has a decision in the matrix', () => {
    const fromServer = expandAlternatives(ROUTE.source);
    assert.ok(fromServer.length >= 10, `parsed ${fromServer.join(',')}`);
    assert.deepEqual(fromServer.filter((r) => !covered().has(r)), [], 'routes with no matrix operation');
    const expected = ['api', 'ai', 'db', ...AUTH_OPS.map((o) => `auth/${o}`), ...STORAGE_OPS.map((o) => `storage/${o}`)].sort();
    assert.deepEqual([...fromServer].sort(), expected, 'ROUTE regexp and the exported op lists disagree');
});
t('coverage: notify, pay and admin route families are all in the matrix', () => {
    for (const o of NOTIFY_OPS) assert.ok(covered().has(`notify/${o}`), `notify/${o}`);
    for (const o of PAY_OPS) assert.ok(covered().has(`pay/${o}`), `pay/${o}`);
    for (const s of ADMIN_SUBS) assert.ok(covered().has(`admin/${s}`), `admin/${s}`);
    assert.ok(covered().has('admin/apps'));
    const adminOps = OPS.filter((o) => o.route.startsWith('admin')).map((o) => o.id);
    for (const frag of ['schema_plan', 'schema_get', 'schema_post', 'secret_get', 'secret_put', 'secret_delete', 'secrets_list', 'jobs_get', 'jobs_post', 'copy_secrets_into_attacker', 'put_app', 'get_app']) assert.ok(adminOps.some((i) => i.includes(frag)), frag);
});
t('coverage: server.js has exactly the known top-level dispatch sites (a new one needs a matrix decision)', () => {
    const src = fs.readFileSync(`${ROOT}proxy-app/server.js`, 'utf8');
    const sites = [
        [/url\.pathname === '\/health'/g, 1], [/url\.pathname === '\/admin' \|\| url\.pathname\.startsWith\('\/admin\/'\)/g, 1], [/notifyHttp\.handle\(/g, 1], [/PAY_ROUTE\.exec\(/g, 1], [/(?<!PAY_)ROUTE\.exec\(url\.pathname\)/g, 1],
        [/route === 'db'/g, 1], [/route\.startsWith\('storage\/'\)/g, 1], [/route\.startsWith\('auth\/'\)/g, 1], [/route === 'ai'/g, 1],
    ];
    for (const [re, n] of sites) assert.equal((src.match(re) || []).length, n, String(re));
    assert.equal((src.match(/url\.pathname/g) || []).length, 8, 'a new url.pathname test was added to server.js: decide where it belongs in the matrix, then update this count');
    const notify = fs.readFileSync(`${ROOT}notify/http.js`, 'utf8');
    assert.deepEqual([...new Set([...notify.matchAll(/op === '([a-z]+)'/g)].map((m) => m[1]))], ['unsubscribe']);
    const pay = fs.readFileSync(`${ROOT}pay/http.js`, 'utf8');
    assert.deepEqual([...pay.matchAll(/op === '([a-z]+)'/g)].map((m) => m[1]).sort(), ['checkout', 'webhook']);
});
