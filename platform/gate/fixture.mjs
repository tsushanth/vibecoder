// Two-tenant fixture for the cross-tenant gate: apps A and B, each with end users, tables of every access mode, files, an order,
// a notify opt-out, a job, secrets and a manifest. All "canary" strings are unique so any appearance of one in a response or log is a leak.
import { createHash, randomBytes } from 'node:crypto';
import { createDataExecutor } from '../data/executor.js';
import { validateSpec } from '../data/schema.js';
import { createAuthStore } from '../auth/pgStore.js';
import { createJobsStore } from '../jobs/store.js';
import { signUnsubscribe } from '../notify/token.js';
import { createHmac } from 'node:crypto';
import { PNG, UPSTREAM_HOST } from './harness.mjs';

export const TABLES = ['t_owner', 't_pub', 't_auth', 't_priv'];
export const ACCESS = { t_owner: 'owner', t_pub: 'public_read', t_auth: 'authenticated', t_priv: 'private' };
export const SPEC = { version: 1, tables: Object.fromEntries(TABLES.map((t) => [t, { access: ACCESS[t], columns: { v: { type: 'text' } } }])) };
export const sha = (s) => createHash('sha256').update(s).digest();

export function stripeSign(raw, secret, ts = Math.floor(Date.now() / 1000)) {
    return `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex')}`;
}

/** Builds one tenant. tag is 'A' or 'B'. Returns everything the matrix needs plus its canary lists. */
export async function seedTenant(P, app, tag) {
    const lc = tag.toLowerCase();
    const T = { app, tag, domain: `${lc}.example.com`, conn: `${lc}conn`, item: `${lc}-pro`, rowIds: {}, canary: {}, publicOk: {} };
    T.stripeKey = ['sk', 'test', `${tag}CANARY0123456789abcdef`].join('_');
    T.whSecret = ['whsec', `${lc}canary`, 'fixture0123'].join('_');
    T.apiKey = ['key', `${lc}canary`, 'QX7Z', randomBytes(4).toString('hex')].join('-');
    const catalog = [{ id: T.item, name: 'Pro plan', amountCents: 1999, currency: 'usd', mode: 'payment', maxQuantity: 3 }];
    const manifest = { connectors: { [T.conn]: { host: UPSTREAM_HOST, paths: ['/v1/*'], methods: ['GET'], secret: { name: `API_KEY_${tag}`, in: 'header', field: 'x-api-key' } } }, pay: { catalog } };
    await P.stores.upsertApp({ appId: app, enabled: true, domains: [T.domain], manifest });
    await P.stores.secretStore.set(app, 'STRIPE_SECRET_KEY', T.stripeKey);
    await P.stores.secretStore.set(app, 'STRIPE_WEBHOOK_SECRET', T.whSecret);
    await P.stores.secretStore.set(app, `API_KEY_${tag}`, T.apiKey);
    const ex = createDataExecutor({ pool: P.proxyPool });
    const applied = await ex.applySchema({ appId: app, spec: validateSpec(SPEC).spec });
    if (!applied.ok) throw new Error('schema apply failed');
    const loc = (await P.db.pool.query('select role_name, schema_name from platform.app_dbs where app_id = $1', [app])).rows[0];
    T.role = loc.role_name; T.schema = loc.schema_name;

    const mk = async (n) => {
        const email = `${lc}${n}-canary-${randomBytes(3).toString('hex')}@${lc}tenant.test`;
        const { token, user } = await P.signIn(app, email);
        const jti = (await P.db.pool.query('select jti from platform.sessions where app_id = $1 and user_id = $2', [app, user.id])).rows[0].jti;
        return { email, id: user.id, token, jti };
    };
    T.u1 = await mk(1); T.u2 = await mk(2);
    T.u3 = await mk(3); await P.call(`/${app}/auth/signout`, { token: T.u3.token });                       // revoked session
    T.u4 = await mk(4); await P.db.pool.query('delete from platform.sessions where app_id = $1 and user_id = $2', [app, T.u4.id]); // session row deleted

    const val = (kind, who) => `${tag}-${kind}-${who}-canary-${randomBytes(3).toString('hex')}`;
    const ins = async (table, user, who) => {
        const v = val(table, who);
        const r = await P.call(`/${app}/db`, { token: user.token, body: { op: 'insert', table, rows: [{ v }] } });
        if (r.status !== 200) throw new Error(`seed insert ${table} failed: ${r.status}`);
        return { v, id: r.json.rows[0].id };
    };
    const rows = { t_owner: { u1: await ins('t_owner', T.u1, 'u1'), u2: await ins('t_owner', T.u2, 'u2') }, t_pub: { u1: await ins('t_pub', T.u1, 'u1'), u2: await ins('t_pub', T.u2, 'u2') }, t_auth: { u1: await ins('t_auth', T.u1, 'u1'), u2: await ins('t_auth', T.u2, 'u2') } };
    const pv = val('t_priv', 'u1');
    const pid = (await P.db.pool.query(`insert into "${T.schema}"."t_priv" (v, user_id) values ($1, $2) returning id`, [pv, T.u1.id])).rows[0].id;
    rows.t_priv = { u1: { v: pv, id: pid } };
    T.rows = rows;
    for (const t of TABLES) for (const [u, r] of Object.entries(rows[t])) T.rowIds[`${t}.${u}`] = r.id;

    const up = async (name, query = '') => {
        const r = await P.call(`/${app}/storage/upload?name=${encodeURIComponent(name)}${query}`, { token: T.u1.token, body: PNG, headers: { 'content-type': 'image/png' } });
        if (r.status !== 200) throw new Error(`seed upload failed: ${r.status}`);
        const key = (await P.db.pool.query('select object_key from platform.files where id = $1', [r.json.file.id])).rows[0].object_key;
        return { id: r.json.file.id, name: r.json.file.name, key };
    };
    T.filePriv = await up(`${tag}-priv-canary.png`); T.filePub = await up(`${tag}-pub-canary.png`, '&public=1');
    const u2up = await P.call(`/${app}/storage/upload?name=${encodeURIComponent(`${tag}-u2-canary.png`)}`, { token: T.u2.token, body: PNG, headers: { 'content-type': 'image/png' } });
    T.fileU2 = { id: u2up.json.file.id, name: u2up.json.file.name, key: (await P.db.pool.query('select object_key from platform.files where id = $1', [u2up.json.file.id])).rows[0].object_key };

    // an order, created the legitimate way: Stripe's signed webhook for this app
    T.orderSession = `cs_${tag}CANARY001`;
    const raw = JSON.stringify({ id: `evt_${T.orderSession}`, type: 'checkout.session.completed', data: { object: { id: T.orderSession, object: 'checkout.session', payment_status: 'paid', amount_total: 3998, currency: 'usd', client_reference_id: T.u1.id, customer_email: T.u1.email, metadata: { vibe_app: app, vibe_item: T.item, vibe_qty: '2' } } }, });
    const wh = await P.call(`/${app}/pay/webhook`, { body: raw, headers: { 'stripe-signature': stripeSign(raw, T.whSecret) } });
    if (wh.status !== 200 || wh.json?.duplicate !== false) throw new Error(`seed order failed: ${wh.status}`);

    // notify: u2 has opted out
    const un = await P.srv.notify.unsubscribe({ appId: app, token: signUnsubscribe({ masterKey: P.MK, appId: app, userId: T.u2.id }) });
    if (!un.ok) throw new Error('seed opt-out failed');
    T.unsub = (userId) => signUnsubscribe({ masterKey: P.MK, appId: app, userId });

    T.jobId = `${lc}jobcanary`;
    await createJobsStore({ pool: P.db.pool }).setJobs(app, [{ id: T.jobId, schedule: { every: '1h' }, action: { type: 'connector', connector: 'nws', method: 'GET', path: '/alerts/active' } }]);

    // Strings that must never reach a caller who is not this tenant's signed-in user.
    const c = T.canary;
    c.emails = [T.u1.email, T.u2.email, T.u3.email, T.u4.email];
    c.ids = [T.u3.id, T.u4.id, T.rowIds['t_owner.u1'], T.rowIds['t_owner.u2'], T.rowIds['t_auth.u1'], T.rowIds['t_auth.u2'], T.rowIds['t_priv.u1'], T.filePriv.id, T.filePub.id, T.fileU2.id, T.u1.jti, T.u2.jti];
    c.values = [rows.t_owner.u1.v, rows.t_owner.u2.v, rows.t_auth.u1.v, rows.t_auth.u2.v, rows.t_priv.u1.v];
    c.files = [T.filePriv.name, T.filePub.name, T.fileU2.name, T.filePriv.key, T.filePub.key, T.fileU2.key];
    c.misc = [T.orderSession, T.jobId, T.schema, T.role, T.u1.token, T.u2.token, T.u3.token, T.u4.token, T.stripeKey, T.whSecret, T.apiKey];
    // The authors' ids and the public_read rows are served to anyone on a public_read table by design: flagged `pub`, allowed only there.
    T.forbidden = () => [
        ...c.emails.map((x) => ['email', x]), ...c.ids.map((x) => ['id', x]), ...c.values.map((x) => ['value', x]), ...c.files.map((x) => ['file', x]), ...c.misc.map((x) => ['misc', x]),
        ['u1.id', T.u1.id, true], ['u2.id', T.u2.id, true], ['pub.u1.value', rows.t_pub.u1.v, true], ['pub.u2.value', rows.t_pub.u2.v, true], ['pub.u1.id', rows.t_pub.u1.id, true], ['pub.u2.id', rows.t_pub.u2.id, true],
    ];
    T.authStore = createAuthStore({ pool: P.db.pool });
    return T;
}

/** Everything the platform stores about one tenant, for before/after comparison. */
export async function snapshot(P, T) {
    const q = async (sql, v = []) => (await P.db.pool.query(sql, v)).rows;
    const out = {};
    for (const t of TABLES) out[t] = await q(`select * from "${T.schema}"."${t}" order by id`);
    const byApp = (name, extra = 'order by 1, 2') => q(`select * from platform.${name} where app_id = $1 ${extra}`, [T.app]);
    out.end_users = await byApp('end_users'); out.sessions = await byApp('sessions'); out.files = await byApp('files'); out.orders = await byApp('orders');
    out.notify_optouts = await byApp('notify_optouts'); out.jobs = await byApp('jobs'); out.job_runs = await byApp('job_runs');
    out.secrets = await q('select name, md5(ciphertext) as h from platform.app_secrets where app_id = $1 order by name', [T.app]);
    out.app = await q('select enabled, domains, manifest::text as manifest from platform.apps where app_id = $1', [T.app]);
    out.app_db = await q('select role_name, schema_name, spec::text as spec, version from platform.app_dbs where app_id = $1', [T.app]);
    return JSON.stringify(out);
}

/** A malicious or confused creator of `T` records an order (through T's own signed webhook) that names a user of ANOTHER app as the buyer. */
export async function addForeignReferenceOrder(P, T, foreignUserId) {
    const sessionId = `cs_${T.tag}FOREIGNREF002`;
    const raw = JSON.stringify({ id: `evt_${sessionId}`, type: 'checkout.session.completed', data: { object: { id: sessionId, object: 'checkout.session', payment_status: 'paid', amount_total: 500, currency: 'usd', client_reference_id: foreignUserId, customer_email: T.u1.email, metadata: { vibe_app: T.app, vibe_item: T.item, vibe_qty: '1' } } } });
    const r = await P.call(`/${T.app}/pay/webhook`, { body: raw, headers: { 'stripe-signature': stripeSign(raw, T.whSecret) } });
    if (r.status !== 200 || r.json?.duplicate !== false) throw new Error('foreign-ref order failed');
    T.foreignOrderSession = sessionId; T.canary.misc.push(sessionId);
}
