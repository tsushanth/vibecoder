import test from 'node:test';
import assert from 'node:assert/strict';
import { isReservedSubdomain } from '../../services/reservedSubdomains.js';

test('platform names are reserved, in any letter case', () => {
    for (const n of ['vibe-proxy', 'www', 'api', 'admin', 'app', 'mail', 'send', 'unsubscribe', 'cdn', 'status', 'vibebuild', 'vibecoder-api', 'vibecoder-deploy', 'VIBE-PROXY', 'Www']) assert.equal(isReservedSubdomain(n), true, n);
});

test('the preview prefixes used for automatic previews are reserved', () => {
    for (const n of ['preview-abc123', 'prev-70d01c3b', 'preview-', 'prev-x']) assert.equal(isReservedSubdomain(n), true, n);
});

test('ordinary creator names are not reserved, including ones that merely contain or resemble reserved words', () => {
    for (const n of ['my-app', 'weather-now', 'vibe-check', 'proxy', 'api-tester', 'adminpanel', 'preview', 'prevent-x', 'previewer', 'wwwx', 'sendit']) assert.equal(isReservedSubdomain(n), false, n);
});

test('non-strings are not reserved (validation elsewhere rejects them)', () => {
    for (const n of [undefined, null, 42, {}]) assert.equal(isReservedSubdomain(n), false);
});

test('project ids (UUIDs) are reserved because they are the platform app ids for key storage', () => {
    for (const n of ['11111111-2222-3333-4444-555555555555', 'abcdef12-3456-7890-abcd-ef1234567890', 'ABCDEF12-3456-7890-ABCD-EF1234567890']) assert.equal(isReservedSubdomain(n), true, n);
});

test('names that only resemble a UUID are not reserved', () => {
    for (const n of ['11111111-2222-3333-4444-55555555555', '11111111-2222-3333-4444-5555555555555', 'my-11111111-2222-3333-4444-555555555555', 'gggggggg-2222-3333-4444-555555555555']) assert.equal(isReservedSubdomain(n), false, n);
});
