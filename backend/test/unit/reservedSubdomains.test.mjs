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
