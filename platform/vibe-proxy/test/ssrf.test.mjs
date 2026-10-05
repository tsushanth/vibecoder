import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl } from '../ssrf.js';

const pub = async () => ['93.184.216.34'];

test('allows a plain https URL that resolves to a public address', async () => {
    assert.deepEqual(await checkUrl('https://api.open-meteo.com/v1/forecast?x=1', { resolve: pub }), { ok: true });
});

for (const [name, url] of [
    ['plain http', 'http://api.example.com/'],
    ['file scheme', 'file:///etc/passwd'],
    ['embedded credentials', 'https://user:pw@api.example.com/'],
    ['non-443 port', 'https://api.example.com:8443/'],
    ['loopback name', 'https://localhost/'],
    ['loopback ip', 'https://127.0.0.1/'],
    ['cloud metadata ip', 'https://169.254.169.254/latest/meta-data/'],
    ['private 10/8', 'https://10.0.0.5/'],
    ['private 192.168/16', 'https://192.168.1.1/'],
    ['private 172.16/12', 'https://172.20.0.1/'],
    ['ipv6 loopback', 'https://[::1]/'],
    ['ipv4-mapped ipv6 loopback', 'https://[::ffff:127.0.0.1]/'],
    ['decimal ip', 'https://2130706433/'],
    ['hex ip', 'https://0x7f000001/'],
    ['octal ip', 'https://0177.0.0.1/'],
    ['unparseable', 'not a url'],
    ['internal suffix', 'https://db.internal/'],
    ['dot-local suffix', 'https://printer.local/'],
]) {
    test(`blocks ${name}`, async () => {
        const r = await checkUrl(url, { resolve: pub });
        assert.equal(r.ok, false, url);
        assert.ok(r.reason, 'a reason is returned');
    });
}

test('blocks a public-looking name that resolves to a private address (DNS rebinding)', async () => {
    const r = await checkUrl('https://evil.example.com/', { resolve: async () => ['10.1.2.3'] });
    assert.equal(r.ok, false);
});

test('blocks when any one of several resolved addresses is private', async () => {
    const r = await checkUrl('https://mixed.example.com/', { resolve: async () => ['93.184.216.34', '127.0.0.1'] });
    assert.equal(r.ok, false);
});

test('blocks when the name does not resolve', async () => {
    const r = await checkUrl('https://nope.example.com/', { resolve: async () => [] });
    assert.equal(r.ok, false);
});

test('blocks when resolution throws', async () => {
    const r = await checkUrl('https://boom.example.com/', { resolve: async () => { throw new Error('dns down'); } });
    assert.equal(r.ok, false);
});
