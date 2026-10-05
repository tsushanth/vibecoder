import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';

const HEX = 'a'.repeat(64);
const ADMIN = 'admin-' + 'k'.repeat(40);
const base = () => ({ DATABASE_URL: 'postgres://u:p@h:5432/db', VIBE_MASTER_KEY: HEX, OPENROUTER_API_KEY: 'sk-or-v1-x', BASE_DOMAIN: 'vibebuild.cc', PROXY_ADMIN_TOKEN: ADMIN });

test('loads required settings and applies defaults', () => {
    const c = loadConfig(base());
    assert.equal(c.port, 8080);
    assert.equal(c.baseDomain, 'vibebuild.cc');
    assert.equal(c.limits.perIpPerMin, 30);
    assert.equal(c.limits.perAppPerMin, 120);
    assert.equal(c.limits.dailyCalls, 5000);
    assert.equal(c.limits.dailySpendMicros, 50_000);       // $0.05 per app per day
    assert.equal(c.platformAiDailyMicros, 2_000_000);       // $2 per day across all apps (unconfirmed default)
});

test('overrides are read from the environment as numbers', () => {
    const c = loadConfig({ ...base(), PORT: '3000', APP_AI_DAILY_MICROS: '100000', PLATFORM_AI_DAILY_MICROS: '500000', PER_IP_PER_MIN: '10' });
    assert.equal(c.port, 3000); assert.equal(c.limits.dailySpendMicros, 100000); assert.equal(c.platformAiDailyMicros, 500000); assert.equal(c.limits.perIpPerMin, 10);
});

for (const missing of ['DATABASE_URL', 'VIBE_MASTER_KEY', 'OPENROUTER_API_KEY', 'BASE_DOMAIN', 'PROXY_ADMIN_TOKEN']) {
    test(`refuses to start without ${missing} and names it`, () => {
        const e = base(); delete e[missing];
        assert.throws(() => loadConfig(e), (err) => err.message.includes(missing));
    });
}

test('a bad master key is rejected without echoing its value', () => {
    const bad = 'not-hex-but-secret-looking-value';
    assert.throws(() => loadConfig({ ...base(), VIBE_MASTER_KEY: bad }), (err) => /VIBE_MASTER_KEY/.test(err.message) && !err.message.includes(bad));
});

for (const [k, v] of [['PORT', 'abc'], ['PORT', '0'], ['PORT', '99999'], ['PLATFORM_AI_DAILY_MICROS', '-5'], ['APP_AI_DAILY_MICROS', 'free'], ['PER_IP_PER_MIN', '0']]) {
    test(`rejects ${k}=${v}`, () => {
        assert.throws(() => loadConfig({ ...base(), [k]: v }), (err) => err.message.includes(k));
    });
}

test('a database URL with a password is never included in an error message', () => {
    assert.throws(() => loadConfig({ ...base(), PORT: 'abc' }), (err) => !err.message.includes('p@h') && !err.message.includes('postgres://'));
});

test('the config object does not leak secrets through JSON.stringify', () => {
    const s = JSON.stringify(loadConfig(base()));
    assert.equal(s.includes(HEX), false); assert.equal(s.includes('sk-or-v1-x'), false); assert.equal(s.includes('postgres://'), false);
});

test('config values are available to the server through accessors', () => {
    const c = loadConfig(base());
    assert.equal(c.secrets.masterKey, HEX); assert.equal(c.secrets.openRouterKey, 'sk-or-v1-x'); assert.equal(c.secrets.databaseUrl, 'postgres://u:p@h:5432/db');
});

test('the admin token must be at least 32 characters, and a short one is rejected without echoing it', () => {
    const short = 'shortsecrettoken';
    assert.throws(() => loadConfig({ ...base(), PROXY_ADMIN_TOKEN: short }), (e) => /PROXY_ADMIN_TOKEN/.test(e.message) && !e.message.includes(short));
});
test('the admin token is available through secrets and absent from JSON', () => {
    const c = loadConfig(base());
    assert.equal(c.secrets.adminToken, ADMIN); assert.equal(JSON.stringify(c).includes(ADMIN), false);
});

test('the database pool size defaults to 5 and is configurable within 1 to 20', () => {
    assert.equal(loadConfig(base()).dbPoolMax, 5);
    assert.equal(loadConfig({ ...base(), DB_POOL_MAX: '8' }).dbPoolMax, 8);
    for (const bad of ['0', '21', 'many', '-1', '2.5']) assert.throws(() => loadConfig({ ...base(), DB_POOL_MAX: bad }), (e) => /DB_POOL_MAX/.test(e.message), bad);
});

test('mail sending is optional; a key without a from address is refused; the key stays out of JSON', () => {
    const c = loadConfig(base()); assert.equal(c.secrets.resendKey, null); assert.equal(c.authMailFrom, null);
    assert.throws(() => loadConfig({ ...base(), RESEND_API_KEY: 're_testkey12345' }), /AUTH_MAIL_FROM/);
    const d = loadConfig({ ...base(), RESEND_API_KEY: 're_testkey12345', AUTH_MAIL_FROM: 'Vibe <login@mail.vibebuild.cc>' });
    assert.equal(d.secrets.resendKey, 're_testkey12345'); assert.equal(d.authMailFrom, 'Vibe <login@mail.vibebuild.cc>'); assert.equal(JSON.stringify(d).includes('re_testkey'), false);
});
