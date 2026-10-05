import test from 'node:test';
import assert from 'node:assert/strict';
import { moveSecretsToVault } from '../vault-capture.js';

const j = (...p) => p.join('');
const GOOGLE = j('AIza', 'SyA1234567890abcdefghijklmnopqrstuv');
const STRIPE = j('sk_', 'live_abcdefghijklmnopqrstuv1234');

test('stores each found key through setSecret and returns redacted text and the stored names', async () => {
    const stored = [];
    const r = await moveSecretsToVault({ text: `use ${GOOGLE} and ${STRIPE}`, appId: 'myapp', listNames: async () => [], setSecret: async (appId, name, value) => { stored.push([appId, name, value]); } });
    assert.deepEqual(stored.map(([a, n]) => [a, n]).sort(), [['myapp', 'GOOGLE_API_KEY'], ['myapp', 'STRIPE_SECRET_KEY']]);
    assert.deepEqual(stored.find(([, n]) => n === 'GOOGLE_API_KEY')[2], GOOGLE);
    assert.equal(r.text, 'use [SECRET:GOOGLE_API_KEY] and [SECRET:STRIPE_SECRET_KEY]');
    assert.deepEqual(r.stored.sort(), ['GOOGLE_API_KEY', 'STRIPE_SECRET_KEY']); assert.deepEqual(r.failed, []);
});

test('the result never contains a secret value', async () => {
    const r = await moveSecretsToVault({ text: `k ${GOOGLE}`, appId: 'a', listNames: async () => [], setSecret: async () => {} });
    assert.equal(JSON.stringify(r).includes(GOOGLE), false);
});

test('existing vault names are passed in so a new key never overwrites a different one', async () => {
    const stored = [];
    await moveSecretsToVault({ text: `k ${GOOGLE}`, appId: 'a', listNames: async () => ['GOOGLE_API_KEY'], setSecret: async (a, n) => { stored.push(n); } });
    assert.deepEqual(stored, ['GOOGLE_API_KEY_2']);
});

test('a text with no credentials makes no calls and is returned unchanged', async () => {
    let calls = 0;
    const r = await moveSecretsToVault({ text: 'a plain todo app', appId: 'a', listNames: async () => { calls++; return []; }, setSecret: async () => { calls++; } });
    assert.deepEqual(r, { text: 'a plain todo app', stored: [], failed: [] }); assert.equal(calls, 0);
});

test('if storing a key fails the text is still redacted, the name is reported as failed, and the error never carries the value', async () => {
    const r = await moveSecretsToVault({ text: `k ${GOOGLE}`, appId: 'a', listNames: async () => [], setSecret: async (a, n, v) => { throw new Error(`vault rejected ${v}`); } });
    assert.equal(r.text.includes(GOOGLE), false); assert.deepEqual(r.failed, ['GOOGLE_API_KEY']); assert.deepEqual(r.stored, []);
    assert.equal(JSON.stringify(r).includes(GOOGLE), false);
});

test('one failure does not stop the other keys from being stored', async () => {
    const stored = [];
    const r = await moveSecretsToVault({ text: `${GOOGLE} ${STRIPE}`, appId: 'a', listNames: async () => [], setSecret: async (a, n) => { if (n === 'GOOGLE_API_KEY') throw new Error('x'); stored.push(n); } });
    assert.deepEqual(stored, ['STRIPE_SECRET_KEY']); assert.deepEqual(r.failed, ['GOOGLE_API_KEY']); assert.deepEqual(r.stored, ['STRIPE_SECRET_KEY']);
});

test('if listing existing names fails the text is still redacted and nothing is stored under a guessed name', async () => {
    let stored = 0;
    const r = await moveSecretsToVault({ text: `k ${GOOGLE}`, appId: 'a', listNames: async () => { throw new Error('down'); }, setSecret: async () => { stored++; } });
    assert.equal(r.text.includes(GOOGLE), false); assert.equal(stored, 0); assert.deepEqual(r.failed, ['GOOGLE_API_KEY']);
});
