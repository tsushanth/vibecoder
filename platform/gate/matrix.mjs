// The cross-tenant matrix, as data. Every route family has operations; every operation states, for each KIND of caller, the exact
// outcome expected. Kinds: anon (no credentials, victim's URL), own (a signed-in user of the attacker's own app, which may carry the
// victim's ids in its payload) and bad (any credential that must not work: a token from the attacker's app, forged, expired, revoked...).
// Adding a route family without adding it here fails gate/test/cross-tenant.test.mjs (see the coverage tests).
import { randomBytes, randomUUID } from 'node:crypto';
import { TABLES, ACCESS, stripeSign } from './fixture.mjs';

const E = (status, error, extra = {}) => ({ status, ...(error ? { error } : {}), ...extra });
const U401 = E(401, 'unauthorized');

let probe = 0;
const probeEmail = () => `probe-${++probe}-${randomBytes(3).toString('hex')}@probe.test`;
const rowsOf = (r) => r.json?.rows || [];

/** Table-driven db operations: select/insert/update/delete on each access mode. */
function dbOps() {
    const ops = [];
    for (const t of TABLES) {
        const acc = ACCESS[t];
        const priv = acc === 'private';
        const anonRead = acc === 'public_read';
        const req = (op, ctx) => {
            const { att, vic, kind } = ctx;
            if (op === 'select') return { op, table: t };
            if (op === 'insert') return { op, table: t, rows: [{ v: 'gate-write' }] };
            const victimRow = vic.rowIds[`${t}.u1`] || vic.rowIds[`${t}.u2`];
            if (op === 'update') return { op, table: t, where: [{ col: 'id', op: 'eq', val: victimRow }], set: { v: 'pwned' } };
            return { op, table: t, where: [{ col: 'id', op: 'eq', val: victimRow }] };
        };
        for (const op of ['select', 'insert', 'update', 'delete']) {
            const ownExp = priv ? E(403, 'forbidden') : E(200, undefined, {
                check: (r, { att }) => (op === 'select' ? rowsOf(r).every((x) => (acc === 'owner' ? x.user_id === att.u1.id : true)) && !(acc === 'owner' && rowsOf(r).some((x) => x.user_id === att.u2.id)) : (op === 'insert' ? r.json.count === 1 : rowsOf(r).length === 0 && (op === 'update' || r.json.count === 0))),
            });
            ops.push({
                route: 'db', id: `db.${acc}.${op}`,
                build: (ctx) => ({ path: `/${ctx.id.app}/db`, body: req(op, ctx) }),
                exp: {
                    anon: priv ? E(403, 'forbidden') : (anonRead && op === 'select' ? E(200, undefined, { allowPublic: true, check: (r, { vic }) => rowsOf(r).some((x) => x.v === vic.rows.t_pub.u1.v) }) : E(401, 'unauthenticated')),
                    bad: U401, own: ownExp,
                },
            });
        }
    }
    // intra-app ownership: a signed-in user must not touch another user's rows in the same app (the predicate the cross-tenant gate also leans on)
    for (const t of ['t_owner', 't_auth', 't_pub']) {
        for (const op of ['update', 'delete']) {
            ops.push({
                route: 'db', id: `db.peer_row.${t}.${op}`,
                build: (ctx) => ({ path: `/${ctx.id.app}/db`, body: op === 'update' ? { op, table: t, where: [{ col: 'id', op: 'eq', val: ctx.att.rowIds[`${t}.u2`] }], set: { v: 'peer-overwrite' } } : { op, table: t, where: [{ col: 'id', op: 'eq', val: ctx.att.rowIds[`${t}.u2`] }] } }),
                exp: { anon: E(401, 'unauthenticated'), bad: U401, own: E(200, undefined, { check: (r) => rowsOf(r).length === 0 && (op === 'update' || r.json.count === 0) }) },
            });
        }
    }
    return ops;
}

const sel = (extra) => (ctx) => ({ path: `/${ctx.id.app}/db`, body: { op: 'select', table: 't_owner', ...extra(ctx) } });
function dbAbuseOps() {
    const ops = [];
    const add = (id, build, exp) => ops.push({ route: 'db', id: `db.abuse.${id}`, build, exp });
    const noRows = (r) => rowsOf(r).length === 0;
    // identity spoofing through where / set / rows / keys
    add('where_user_id_owner', sel((c) => ({ where: [{ col: 'user_id', op: 'eq', val: c.vic.u1.id }] })), { anon: E(401, 'unauthenticated'), bad: U401, own: E(200, undefined, { check: noRows }) });
    add('where_user_id_authenticated', (c) => ({ path: `/${c.id.app}/db`, body: { op: 'select', table: 't_auth', where: [{ col: 'user_id', op: 'eq', val: c.vic.u1.id }] } }), { anon: E(401, 'unauthenticated'), bad: U401, own: E(200, undefined, { check: noRows }) });
    add('where_user_id_in', sel((c) => ({ where: [{ col: 'user_id', op: 'in', val: [c.vic.u1.id, c.vic.u2.id] }] })), { anon: E(401, 'unauthenticated'), bad: U401, own: E(200, undefined, { check: noRows }) });
    add('where_like_all', sel(() => ({ where: [{ col: 'v', op: 'like', val: '%' }] })), { anon: E(401, 'unauthenticated'), bad: U401, own: E(200, undefined, { check: (r, c) => rowsOf(r).length > 0 && rowsOf(r).every((x) => x.user_id === c.att.u1.id) }) });
    add('where_injection_value', sel(() => ({ where: [{ col: 'v', op: 'eq', val: "' OR '1'='1" }, { col: 'v', op: 'eq', val: '1 OR 1=1' }] })), { anon: E(401, 'unauthenticated'), bad: U401, own: E(200, undefined, { check: noRows }) });
    for (const t of ['t_owner', 't_pub', 't_auth']) {
        add(`insert_user_id.${t}`, (c) => ({ path: `/${c.id.app}/db`, body: { op: 'insert', table: t, rows: [{ v: 'x', user_id: c.vic.u1.id }] } }), { anon: E(401, 'unauthenticated'), bad: U401, own: E(400, 'reserved_column') });
        add(`insert_id.${t}`, (c) => ({ path: `/${c.id.app}/db`, body: { op: 'insert', table: t, rows: [{ v: 'x', id: c.vic.rowIds[`${t}.u1`] || randomUUID() }] } }), { anon: E(401, 'unauthenticated'), bad: U401, own: E(400, 'reserved_column') });
        add(`update_set_user_id.${t}`, (c) => ({ path: `/${c.id.app}/db`, body: { op: 'update', table: t, where: [{ col: 'id', op: 'eq', val: c.att.rowIds[`${t}.u1`] }], set: { user_id: c.vic.u1.id } } }), { anon: E(401, 'unauthenticated'), bad: U401, own: E(400, 'reserved_column') });
    }
    add('unknown_key_user_id', (c) => ({ path: `/${c.id.app}/db`, body: { op: 'select', table: 't_owner', user_id: c.vic.u1.id } }), { anon: E(400, 'unknown_key'), bad: U401, own: E(400, 'unknown_key') });
    add('unknown_key_schema', (c) => ({ path: `/${c.id.app}/db`, body: { op: 'select', table: 't_owner', schema: c.vic.schema } }), { anon: E(400, 'unknown_key'), bad: U401, own: E(400, 'unknown_key') });
    add('unknown_key_app', (c) => ({ path: `/${c.id.app}/db`, body: { op: 'select', table: 't_owner', appId: c.vic.app, app_id: c.vic.app } }), { anon: E(400, 'unknown_key'), bad: U401, own: E(400, 'unknown_key') });
    // identifier abuse: table names (schema-qualified, SQL-ish, prototype names, wrong types)
    const tableNames = (c) => [
        'end_users', 'sessions', 'platform.end_users', 'platform.sessions', 'platform.app_secrets', `${c.vic.schema}.t_owner`, `"${c.vic.schema}"."t_owner"`, '"t_owner"', 'T_OWNER', 't_owner ', ' t_owner',
        't_owner; drop table t_owner', "t_owner' or '1'='1", 't_owner--', 't_owner/*x*/', '../t_owner', 'pg_catalog.pg_roles', 'pg_roles', 'information_schema.tables', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 't_owner\u0000', 't_owner\n',
        null, 123, true, ['t_owner'], { name: 't_owner' }, 'x'.repeat(5000),
    ];
    for (let i = 0; i < 31; i++) {
        add(`table_name_${i}`, (c) => ({ path: `/${c.id.app}/db`, body: { op: 'select', table: tableNames(c)[i] } }), { anon: E(400, 'unknown_table'), bad: U401, own: E(400, 'unknown_table') });
    }
    // column / order / columns / op / operator abuse on a real table
    const colNames = (c) => ['"; drop table t_owner;--', 'user_id" or "1"="1', 'v or 1=1', '*', 'pg_sleep(10)', 'id::text', `${c.vic.schema}.v`, 't_owner.v', '__proto__', 'constructor', '', null, 7, ['v'], 'V', 'v ', 'v\u0000'];
    for (let i = 0; i < 17; i++) {
        add(`where_col_${i}`, sel((c) => ({ where: [{ col: colNames(c)[i], op: 'eq', val: 'x' }] })), { anon: E(401, 'unauthenticated'), bad: U401, own: E(400, 'unknown_column') });
        add(`order_col_${i}`, sel((c) => ({ order: [{ col: colNames(c)[i] }] })), { anon: E(401, 'unauthenticated'), bad: U401, own: E(400, 'unknown_column') });
        add(`columns_${i}`, sel((c) => ({ columns: [colNames(c)[i]] })), { anon: E(401, 'unauthenticated'), bad: U401, own: E(400, 'unknown_column') });
    }
    const opNames = ['drop', 'select; select 1', 'SELECT', '', 'upsert', 'truncate', 'select\u0000', null, 5, ['select']];
    for (let i = 0; i < opNames.length; i++) add(`op_${i}`, (c) => ({ path: `/${c.id.app}/db`, body: { op: opNames[i], table: 't_owner' } }), { anon: E(400, 'unknown_op'), bad: U401, own: E(400, 'unknown_op') });
    const whereOps = ['eq; drop table t_owner', '= 1 or 1=1 --', 'EQ', '', 'union', null, 'like ', 'is_not_null'];
    for (let i = 0; i < whereOps.length; i++) add(`where_op_${i}`, sel(() => ({ where: [{ col: 'v', op: whereOps[i], val: 'x' }] })), { anon: E(401, 'unauthenticated'), bad: U401, own: E(400, 'bad_operator') });
    return ops;
}

function storageOps() {
    const ops = [];
    const upload = (name) => (c) => ({ path: `/${c.id.app}/storage/upload?name=${encodeURIComponent(name)}`, raw: true, body: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]), headers: { 'content-type': 'image/png' } });
    const ownKeyOk = (r, { att, vic, p }) => p.r2.slice(-1).every((x) => x.url.startsWith(`https://${'a'.repeat(32)}.r2.cloudflarestorage.com/gate-test-files/${att.app}/${att.u1.id}/`) && !x.url.includes(vic.app) && !x.url.includes(vic.u1.id));
    for (const [i, name] of ['plain.png', `../../app/x.png`, '..\\..\\x.png', '/etc/passwd', '%2e%2e%2fx.png', 'a/b/../c.png', 'x'.repeat(300) + '.png'].entries()) {
        ops.push({ route: 'storage/upload', id: `storage.upload.${i}`, build: upload(name), exp: { anon: U401, bad: U401, own: E(200, undefined, { r2: 1, check: ownKeyOk }) } });
    }
    ops.push({ route: 'storage/upload', id: 'storage.upload.victim_name', build: (c) => upload(`../${c.vic.app}/${c.vic.u1.id}/x.png`)(c), exp: { anon: U401, bad: U401, own: E(200, undefined, { r2: 1, check: ownKeyOk }) } });
    ops.push({ route: 'storage/list', id: 'storage.list', build: (c) => ({ path: `/${c.id.app}/storage/list`, body: {} }), exp: { anon: U401, bad: U401, own: E(200, undefined, { check: (r, c) => (r.json.files || []).every((f) => f.id !== c.vic.filePriv.id && f.id !== c.vic.filePub.id) }) } });
    ops.push({ route: 'storage/list', id: 'storage.list.victim_user_param', build: (c) => ({ path: `/${c.id.app}/storage/list?userId=${c.vic.u1.id}&app=${c.vic.app}`, body: { userId: c.vic.u1.id, appId: c.vic.app } }), exp: { anon: U401, bad: U401, own: E(200, undefined, { check: (r, c) => (r.json.files || []).every((f) => f.id !== c.vic.filePriv.id && f.id !== c.vic.filePub.id) }) } });
    for (const [n, pick] of [['private', (v) => v.filePriv.id], ['public', (v) => v.filePub.id]]) {
        for (const op of ['url', 'delete']) {
            ops.push({ route: `storage/${op}`, id: `storage.${op}.victim_${n}_file`, build: (c) => ({ path: `/${c.id.app}/storage/${op}`, body: { id: pick(c.vic) } }), exp: { anon: U401, bad: U401, own: E(404, 'not_found', { r2: 0 }) } });
        }
    }
    // intra-app: a user must not read or delete another user's private file in the same app
    for (const op of ['url', 'delete']) ops.push({ route: `storage/${op}`, id: `storage.${op}.peer_private_file`, build: (c) => ({ path: `/${c.id.app}/storage/${op}`, body: { id: c.att.fileU2.id } }), exp: { anon: U401, bad: U401, own: E(404, 'not_found', { r2: 0 }) } });
    const ids = (c) => ['../..', "x' or 1=1--", '', null, 7, [c.vic.filePriv.id], { id: c.vic.filePriv.id }, c.vic.filePriv.id.toUpperCase() + ' ', `${c.vic.filePriv.id}/../x`];
    for (let i = 0; i < 9; i++) for (const op of ['url', 'delete']) ops.push({ route: `storage/${op}`, id: `storage.${op}.id_abuse_${i}`, build: (c) => ({ path: `/${c.id.app}/storage/${op}`, body: { id: ids(c)[i] } }), exp: { anon: U401, bad: U401, own: E(404, 'not_found', { r2: 0 }) } });
    return ops;
}

export function buildOps() {
    const ops = [];
    // ---- auth ----
    ops.push({ route: 'auth/me', id: 'auth.me', build: (c) => ({ path: `/${c.id.app}/auth/me`, body: {} }), exp: { anon: U401, bad: U401, own: E(200, undefined, { check: (r, c) => r.json.user.id === c.att.u1.id && r.json.user.email === c.att.u1.email }) } });
    ops.push({ route: 'auth/signout', id: 'auth.signout', fresh: true, build: (c) => ({ path: `/${c.id.app}/auth/signout`, body: {} }), skip: { leaked_key_unknown_jti: 'a validly signed token proves key possession; signout then succeeds harmlessly (no such session)', leaked_key_sub_mismatch: 'valid signature + real jti revokes that session by design of key holders', leaked_key_attacker_session_jti: 'valid signature under the victim key, but the jti belongs to another app so nothing is revoked; answers 200 (idempotent)', revoked_session_on_own_app: 'signout is idempotent: a validly signed token for a revoked session answers 200', session_row_deleted_on_own_app: 'signout is idempotent: a validly signed token with no session row answers 200' }, exp: { anon: U401, bad: U401, own: E(200) } });
    ops.push({ route: 'auth/consume', id: 'auth.consume.foreign_link', needsLink: true, build: (c) => ({ path: `/${c.id.app}/auth/consume`, body: { token: c.link } }), exp: { anon: E(400, 'invalid_link'), bad: E(400, 'invalid_link'), own: E(400, 'invalid_link') } });
    ops.push({ route: 'auth/consume', id: 'auth.consume.garbage', build: (c) => ({ path: `/${c.id.app}/auth/consume`, body: { token: 'x'.repeat(43) } }), exp: { anon: E(400, 'invalid_link'), bad: E(400, 'invalid_link'), own: E(400, 'invalid_link') } });
    ops.push({ route: 'auth/request', id: 'auth.request.probe', build: (c) => ({ path: `/${c.id.app}/auth/request`, body: { email: probeEmail() } }), exp: { anon: E(200, undefined, { check: (r) => r.json?.ok === true }), bad: E(200, undefined, { check: (r) => r.json?.ok === true }), own: E(200, undefined, { check: (r) => r.json?.ok === true }) } });
    // ---- db ----
    ops.push(...dbOps(), ...dbAbuseOps());
    // ---- storage ----
    ops.push(...storageOps());
    // ---- notify ----
    ops.push({ route: 'notify/me', id: 'notify.me', build: (c) => ({ path: `/${c.id.app}/notify/me`, body: { subject: 'gate', text: 'gate', to: c.vic.u1.email, cc: c.vic.u2.email, email: c.vic.u1.email, userId: c.vic.u1.id, from: c.vic.u1.email } }), exp: { anon: U401, bad: U401, own: E(200, undefined, { mail: (m, c) => m.length === 1 && m[0].to.length === 1 && m[0].to[0] === c.att.u1.email }) } });
    for (const method of ['GET', 'POST']) {
        // anon/bad: a token minted for the attacker's app presented on the victim's URL; own: a token minted for the victim's app presented on the attacker's URL
        ops.push({ route: 'notify/unsubscribe', id: `notify.unsubscribe.${method}.foreign_app_token`, build: (c) => ({ path: `/${c.id.app}/notify/unsubscribe?t=${encodeURIComponent(c.onAtt ? c.vic.unsub(c.vic.u1.id) : c.att.unsub(c.att.u1.id))}`, method }), exp: { anon: E(400), bad: E(400), own: E(400) } });
    }
    // ---- pay ----
    ops.push({ route: 'pay/checkout', id: 'pay.checkout.victim_item', build: (c) => ({ path: `/${c.id.app}/pay/checkout`, body: { item: c.vic.item, quantity: 1 } }),
        exp: { anon: E(200, undefined, { stripe: 1, check: payCheck }), bad: E(200, undefined, { stripe: 1, check: payCheck }), own: E(404, 'unknown_item', { stripe: 0 }) } });
    ops.push({ route: 'pay/orders', id: 'pay.orders', build: (c) => ({ path: `/${c.id.app}/pay/orders`, body: {} }), exp: { anon: U401, bad: U401, own: E(200, undefined, { check: (r, c) => (r.json.orders || []).length === 1 && r.json.orders[0].sessionId === c.att.orderSession }) } });
    ops.push({ route: 'pay/webhook', id: 'pay.webhook.signed_with_attacker_secret', build: (c) => { const raw = hookBody(c); return { path: `/${c.id.app}/pay/webhook`, raw: true, body: raw, headers: { 'stripe-signature': stripeSign(raw, c.att.whSecret) } }; }, exp: { anon: E(400, 'bad_signature'), bad: E(400, 'bad_signature'), own: E(200, undefined, { check: (r) => r.json?.ignored === true }) } });
    ops.push({ route: 'pay/webhook', id: 'pay.webhook.unsigned', build: (c) => ({ path: `/${c.id.app}/pay/webhook`, raw: true, body: hookBody(c) }), exp: { anon: E(400, 'bad_signature'), bad: E(400, 'bad_signature'), own: E(400, 'bad_signature') } });
    ops.push({ route: 'pay/webhook', id: 'pay.webhook.signed_with_other_secrets', build: (c) => { const raw = hookBody(c); return { path: `/${c.id.app}/pay/webhook`, raw: true, body: raw, headers: { 'stripe-signature': stripeSign(raw, c.p.MK) } }; }, exp: { anon: E(400, 'bad_signature'), bad: E(400, 'bad_signature'), own: E(400, 'bad_signature') } });
    // ---- connector proxy and AI (public by design: callers use the app's own key but never see it) ----
    ops.push({ route: 'api', id: 'api.victim_connector', build: (c) => ({ path: `/${c.id.app}/api`, body: { connector: c.vic.conn, method: 'GET', path: '/v1/data' } }),
        exp: { anon: E(200, undefined, { upstream: 1, check: upstreamCheck }), bad: E(200, undefined, { upstream: 1, check: upstreamCheck }), own: E(404, 'unknown_connector', { upstream: 0 }) } });
    ops.push({ route: 'ai', id: 'ai.chat', build: (c) => ({ path: `/${c.id.app}/ai`, body: { messages: [{ role: 'user', content: 'hi' }] } }), exp: { anon: E(200), bad: E(200), own: E(200) } });
    // ---- admin: the service token is the only credential; every presented credential here is wrong ----
    const A = (id, route, method, path, body) => ({ route, id: `admin.${id}`, build: (c) => ({ path: path.replace('{vic}', c.vic.app).replace('{att}', c.att.app), method, body: typeof body === 'function' ? body(c) : body, admin: true }), exp: { anon: U401, bad: U401, own: U401 } });
    ops.push(
        A('get_app', 'admin/apps', 'GET', '/admin/apps/{vic}'),
        A('put_app', 'admin/apps', 'PUT', '/admin/apps/{vic}', { manifest: null, domains: ['evil.example.com'], enabled: false }),
        A('manifest', 'admin/manifest', 'POST', '/admin/apps/{vic}/manifest', { manifest: null }),
        A('schema_plan', 'admin/schema', 'POST', '/admin/apps/{vic}/schema/plan', { spec: { version: 1, tables: {} } }),
        A('schema_get', 'admin/schema', 'GET', '/admin/apps/{vic}/schema'),
        A('schema_post', 'admin/schema', 'POST', '/admin/apps/{vic}/schema', { spec: { version: 1, tables: {} }, allowDestructive: true }),
        A('jobs_get', 'admin/jobs', 'GET', '/admin/apps/{vic}/jobs'),
        A('jobs_post', 'admin/jobs', 'POST', '/admin/apps/{vic}/jobs', { jobs: [] }),
        A('copy_secrets_into_attacker', 'admin/copy-secrets', 'POST', '/admin/apps/{att}/copy-secrets', (c) => ({ from: c.vic.app, replace: true })),
        A('copy_secrets_from_attacker', 'admin/copy-secrets', 'POST', '/admin/apps/{vic}/copy-secrets', (c) => ({ from: c.att.app, replace: true })),
        A('ensure', 'admin/ensure', 'POST', '/admin/apps/{vic}/ensure', {}),
        A('enabled_off', 'admin/enabled', 'POST', '/admin/apps/{vic}/enabled', { enabled: false }),
        A('domains', 'admin/domains', 'POST', '/admin/apps/{vic}/domains', { domains: ['evil.example.com'] }),
        A('secrets_list', 'admin/secrets', 'GET', '/admin/apps/{vic}/secrets'),
        A('secret_get', 'admin/secrets', 'GET', '/admin/apps/{vic}/secrets/STRIPE_SECRET_KEY'),
        A('secret_put', 'admin/secrets', 'PUT', '/admin/apps/{vic}/secrets/STRIPE_SECRET_KEY', { value: 'attacker-controlled-value' }),
        A('secret_delete', 'admin/secrets', 'DELETE', '/admin/apps/{vic}/secrets/STRIPE_WEBHOOK_SECRET'),
        A('unknown_root', 'admin/apps', 'GET', '/admin'),
        A('unknown_apps_root', 'admin/apps', 'GET', '/admin/apps'),
        A('unknown_sub', 'admin/apps', 'GET', '/admin/apps/{vic}/nope'),
    );
    return ops;
}

// ---- helpers used by the table ----
function hookBody(c) {
    return JSON.stringify({ id: 'evt_gate', type: 'checkout.session.completed', data: { object: { id: `cs_gate_${randomBytes(3).toString('hex')}`, object: 'checkout.session', payment_status: 'paid', amount_total: 100, currency: 'usd', client_reference_id: c.att.u1.id, customer_email: c.att.u1.email, metadata: { vibe_app: c.vic.app, vibe_item: c.vic.item, vibe_qty: '1' } } } });
}
function payCheck(r, c) {
    const call = c.p.stripe.at(-1);
    return call && call.headers.authorization === `Bearer ${c.vic.stripeKey}` && call.form['metadata[vibe_app]'] === c.vic.app && !JSON.stringify(call.form).includes(c.att.u1.id) && !JSON.stringify(call.form).includes(c.att.u1.email) && !('client_reference_id' in call.form) && !('customer_email' in call.form);
}
function upstreamCheck(r, c) {
    const call = c.p.upstream.at(-1);
    return call && call.headers['x-api-key'] === c.vic.apiKey;
}

// Identities added only for admin operations: near-misses of the real service token.
export const ADMIN_NEAR_MISSES = (adminToken) => [
    ['admin_no_bearer_prefix', adminToken, false], ['admin_lowercase_scheme', adminToken, 'bearer'], ['admin_leading_space', ' ' + adminToken, true], ['admin_token_plus_suffix', adminToken + 'x', true],
    ['admin_truncated', adminToken.slice(0, -1), true], ['admin_prefix_only', adminToken.slice(0, 10), true], ['admin_empty_bearer', '', true],
];
