import test from 'node:test';
import assert from 'node:assert/strict';
import { presignUrl } from '../presign.js';

// The worked example from the AWS documentation for query-string authentication (GET /test.txt on examplebucket).
const AWS = { host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', expiresSec: 86400, accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: Date.UTC(2013, 4, 24) };

test('matches the AWS documented example signature exactly', () => {
    const url = presignUrl(AWS);
    assert.equal(url, 'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('the signature changes with the method, path, expiry, time, key and signed headers', () => {
    const sig = (o) => new URL(presignUrl({ ...AWS, ...o })).searchParams.get('X-Amz-Signature');
    const base = sig({});
    for (const o of [{ method: 'PUT' }, { path: '/other.txt' }, { expiresSec: 60 }, { now: AWS.now + 1000 }, { secretAccessKey: 'x'.repeat(40) }, { signedHeaders: { 'Content-Type': 'image/png' } }, { query: { 'response-content-disposition': 'attachment' } }, { host: 'other.example.com' }])
        assert.notEqual(sig(o), base, JSON.stringify(o));
});

test('signed headers are lower-cased, sorted and listed; response overrides ride in the query', () => {
    const u = new URL(presignUrl({ ...AWS, method: 'PUT', signedHeaders: { 'Content-Type': 'image/png', 'X-Amz-Meta-App': 'a' }, query: { 'response-content-disposition': 'attachment' } }));
    assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'content-type;host;x-amz-meta-app'); assert.equal(u.searchParams.get('response-content-disposition'), 'attachment');
});

test('keys with spaces, unicode and reserved characters are encoded as SigV4 requires', () => {
    const u = presignUrl({ ...AWS, path: "/bucket/a b/é!'()*.txt" });
    assert.match(u, /^https:\/\/examplebucket\.s3\.amazonaws\.com\/bucket\/a%20b\/%C3%A9%21%27%28%29%2A\.txt\?/);
});

test('bad input is refused', () => {
    for (const o of [{ host: '' }, { path: 'no-slash' }, { accessKeyId: '' }, { secretAccessKey: '' }, { expiresSec: 0 }, { expiresSec: 604801 }, { expiresSec: 1.5 }]) assert.throws(() => presignUrl({ ...AWS, ...o }), String(JSON.stringify(o)));
});

test('the secret never appears in the URL', () => assert.equal(presignUrl(AWS).includes(AWS.secretAccessKey), false));
