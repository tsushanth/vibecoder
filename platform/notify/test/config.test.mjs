import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNotifyConfig } from '../config.js';

test('defaults: public url derived from the base domain and conservative limits', () => {
    assert.deepEqual(loadNotifyConfig({}, 'vibebuild.cc'), { baseUrl: 'https://vibe-proxy.vibebuild.cc', limits: { perUserPerHour: 3, perUserPerDay: 10, perAppPerDay: 200, globalPerDay: 2000 } });
});

test('overrides are read as integers and the public url loses a trailing slash', () => {
    const c = loadNotifyConfig({ NOTIFY_PUBLIC_URL: 'https://proxy.example.com/', NOTIFY_USER_PER_HOUR: '1', NOTIFY_USER_PER_DAY: '2', NOTIFY_APP_PER_DAY: '3', NOTIFY_GLOBAL_PER_DAY: '4' }, 'vibebuild.cc');
    assert.deepEqual(c, { baseUrl: 'https://proxy.example.com', limits: { perUserPerHour: 1, perUserPerDay: 2, perAppPerDay: 3, globalPerDay: 4 } });
});

test('bad values refuse to start and name the setting, not its value', () => {
    for (const [k, v] of [['NOTIFY_PUBLIC_URL', 'http://insecure.example.com'], ['NOTIFY_PUBLIC_URL', 'not a url'], ['NOTIFY_USER_PER_HOUR', '-5'], ['NOTIFY_USER_PER_HOUR', 'abc'], ['NOTIFY_GLOBAL_PER_DAY', '99999999999'], ['NOTIFY_APP_PER_DAY', '1.5']]) {
        assert.throws(() => loadNotifyConfig({ [k]: v }, 'vibebuild.cc'), (e) => e.message.includes(k) && !e.message.includes(v), `${k}=${v}`);
    }
});
