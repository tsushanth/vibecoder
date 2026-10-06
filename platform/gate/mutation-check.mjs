// Proves the cross-tenant gate has teeth: breaks one security control at a time in the real source, runs the gate, and requires it to fail.
// Each mutation is applied to the working tree and ALWAYS restored (also on Ctrl-C). Run: cd platform && node gate/mutation-check.mjs [name-filter]
// Needs the same local Postgres as the gate itself. Takes about 8 seconds per mutation.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const M = (name, file, find, replace, control) => ({ name, file, find, replace, control });
export const MUTATIONS = [
    M('ownership predicate removed (user_id scoping in the query builder)', 'data/query.js', 'if (scoped) all.push(', 'if (false) all.push(', 'ownership'),
    M('token app-id claim check removed', 'auth/jwt.js', "if (claims.app_id !== appId) return bad('wrong_app');", '', 'token app-id check'),
    M('JWT key no longer bound to the app id', 'auth/keys.js', 'Buffer.from(appId), Buffer.from(purpose)', "Buffer.from(''), Buffer.from(purpose)", 'JWT app binding'),
    M('session lookup no longer scoped to the app', 'auth/pgStore.js', 's.jti = $1 and s.app_id = $2 and s.revoked_at is null', 's.jti = $1 and $2::text is not null and s.revoked_at is null', 'session app scope'),
    M('login link consume no longer scoped to the app', 'auth/pgStore.js', 'where token_hash = $1 and app_id = $2 and used_at is null', 'where token_hash = $1 and $2::text is not null and used_at is null', 'link app scope'),
    M('storage object key loses the app prefix', 'storage/service.js', 'const key = `${appId}/${userId}/${id}-${clean}`;', 'const key = `${userId}/${id}-${clean}`;', 'storage key prefix'),
    M('storage get no longer scoped to the app', 'storage/pgStore.js', "created_at from platform.files where app_id = $1 and id = $2'", "created_at from platform.files where $1::text is not null and id = $2'", 'storage app scope'),
    M('storage delete no longer scoped to the owner', 'storage/pgStore.js', 'where app_id = $1 and id = $2 and user_id = $3 returning object_key', 'where app_id = $1 and id = $2 and $3::uuid is not null returning object_key', 'storage owner scope'),
    M('role switching: every app reuses the first provisioned role', 'data/executor.js', 'const hit = cache.get(appId);', 'const hit = [...cache.values()][0];', 'role switching (wrong role)'),
    M('role switching: statements run as the proxy login (no SET ROLE)', 'data/executor.js', 'await client.query(`set local role "${role}"`);', '', 'role switching (none)'),
    M('executor safety filter disabled (role-changing statements allowed)', 'data/executor.js', '!FORBIDDEN.test(', '!/^\\u0000$/.test(', 'executor statement guard'),
    M('admin token check always passes', 'proxy-app/admin.js', 'const ok = !!m && timingSafeEqual(digest(m[1]), expected);', 'const ok = true;', 'admin auth'),
    M('CORS: any origin allowed on app routes', 'proxy-app/server.js', "return u.protocol === 'https:' && (u.hostname === `${appId}.${baseDomain}` || (app.domains || []).includes(u.hostname));", 'return true;', 'CORS (server)'),
    M('CORS: any origin allowed on notify routes', 'notify/http.js', "return u.protocol === 'https:' && (u.hostname === `${appId}.${baseDomain}` || (app.domains || []).includes(u.hostname));", 'return true;', 'CORS (notify)'),
    M('CORS: any origin allowed on pay routes', 'pay/http.js', "return u.protocol === 'https:' && (u.hostname === `${appId}.${baseDomain}` || (app.domains || []).includes(u.hostname));", 'return true;', 'CORS (pay)'),
    M('webhook accepts events naming another app', 'pay/service.js', 'meta.vibe_app === appId', 'true', 'webhook app binding'),
    M('orders no longer scoped to the app', 'pay/orderStore.js', 'where app_id = $1 and client_reference_id = $2', 'where $1::text is not null and client_reference_id = $2', 'orders app scope'),
    M('unsubscribe token no longer bound to the app', 'notify/token.js', "deriveAppKey(masterKey, appId, UNSUB_PURPOSE)).update(`${appId}:${userId}`)", "deriveAppKey(masterKey, 'x', UNSUB_PURPOSE)).update(`${userId}`)", 'unsubscribe app binding'),
    M('notify/me recipient taken from the request body', 'notify/http.js', 'userId: session.user.id, subject', 'userId: body.value.userId ?? session.user.id, subject', 'notify recipient'),
];

function run() {
    const r = spawnSync(process.execPath, ['--test', '--test-force-exit', 'gate/test/cross-tenant.test.mjs'], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
    const failed = [...(r.stdout || '').matchAll(/^✖ ((?:matrix|CORS|routing|database|executor|provisioning|coverage|victim|positive|injected|logs)[^\n(]*)/gm)].map((m) => m[1].trim());
    return { status: r.status, failed: [...new Set(failed)] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const filter = process.argv[2];
    const backups = new Map();
    const restore = () => { for (const [f, text] of backups) fs.writeFileSync(f, text); backups.clear(); };
    process.on('SIGINT', () => { restore(); process.exit(130); });
    process.on('exit', restore);
    const baseline = run();
    if (baseline.status !== 0) { console.error('the unmutated gate is not green; fix that first'); process.exit(2); }
    const rows = []; let survived = 0;
    for (const m of MUTATIONS.filter((x) => !filter || x.name.includes(filter) || x.control.includes(filter))) {
        const path = ROOT + m.file;
        const src = fs.readFileSync(path, 'utf8');
        const n = src.split(m.find).length - 1;
        if (n !== 1) { rows.push(`ERROR ${m.name}: pattern found ${n} times in ${m.file}`); console.log(rows.at(-1)); survived++; continue; }
        backups.set(path, src);
        fs.writeFileSync(path, src.replace(m.find, () => m.replace));
        const r = run();
        fs.writeFileSync(path, src); backups.delete(path);
        const caught = r.status !== 0 && r.failed.length > 0;
        if (!caught) survived++;
        rows.push(`${caught ? 'CAUGHT  ' : 'SURVIVED'} ${m.name}  [${m.file}]  failing: ${r.failed.length ? r.failed.map((f) => f.slice(0, 60)).join(' | ') : 'none'}`);
        console.log(rows.at(-1));
    }
    console.log(`\n${rows.length - survived}/${rows.length} mutations caught`);
    process.exit(survived ? 1 : 0);
}
