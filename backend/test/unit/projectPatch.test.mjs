import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePatchBody } from '../../lib/projectPatch.js';

test('a rename alone is accepted and trimmed', () => {
    assert.deepEqual(parsePatchBody({ title: '  My App ' }), { fields: { title: 'My App' } });
});

test('the listing flag alone is accepted, true or false', () => {
    assert.deepEqual(parsePatchBody({ isPublic: true }), { fields: { is_public: true } });
    assert.deepEqual(parsePatchBody({ isPublic: false }), { fields: { is_public: false } });
});

test('both together', () => {
    assert.deepEqual(parsePatchBody({ title: 'X', isPublic: true }), { fields: { title: 'X', is_public: true } });
});

test('the flag must be a real boolean, not a string', () => {
    assert.ok(parsePatchBody({ isPublic: 'true' }).error);
    assert.ok(parsePatchBody({ isPublic: 1 }).error);
    assert.ok(parsePatchBody({ isPublic: null }).error);
});

test('empty, missing, over-long or non-string titles are refused', () => {
    assert.ok(parsePatchBody({}).error);
    assert.ok(parsePatchBody({ title: '   ' }).error);
    assert.ok(parsePatchBody({ title: 'a'.repeat(181) }).error);
    assert.ok(parsePatchBody({ title: 5 }).error);
});
