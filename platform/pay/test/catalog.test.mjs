import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, validatePay, MAX_ITEMS } from '../catalog.js';
import { validateManifest } from '../../vibe-proxy/manifest.js';

const item = (o = {}) => ({ id: 'pro', name: 'Pro plan', amountCents: 999, currency: 'usd', mode: 'payment', ...o });
const bad = (name, list, re) => test(`rejects ${name}`, () => {
    const r = validateCatalog(list);
    assert.equal(r.ok, false);
    assert.match(r.problems.join('|'), re);
});

test('accepts a valid catalog and fills defaults (maxQuantity 1)', () => {
    const r = validateCatalog([item(), item({ id: 'sub', mode: 'subscription', interval: 'month', maxQuantity: 5, amountCents: 50, currency: 'inr' })]);
    assert.deepEqual(r, { ok: true, problems: [] });
});

test('accepts boundary amounts 50 and 99999999 and every allowed currency', () => {
    for (const c of ['usd', 'eur', 'gbp', 'cad', 'aud', 'inr']) assert.equal(validateCatalog([item({ currency: c })]).ok, true, c);
    assert.equal(validateCatalog([item({ amountCents: 50 })]).ok, true);
    assert.equal(validateCatalog([item({ amountCents: 99999999 })]).ok, true);
});

test('accepts exactly MAX_ITEMS (20) items and rejects 21', () => {
    assert.equal(MAX_ITEMS, 20);
    const mk = (n) => Array.from({ length: n }, (_, i) => item({ id: `p${i}` }));
    assert.equal(validateCatalog(mk(20)).ok, true);
    assert.equal(validateCatalog(mk(21)).ok, false);
});

bad('a non-array', { pro: item() }, /array/);
bad('an empty list', [], /at least one/);
bad('a non-object item', ['x'], /object/);
bad('a bad id', [item({ id: 'Pro Plan' })], /id/);
bad('a missing id', [item({ id: undefined })], /id/);
bad('duplicate ids', [item(), item()], /duplicate/);
bad('an empty name', [item({ name: '' })], /name/);
bad('a whitespace-only name', [item({ name: '   ' })], /name/);
bad('a 101 char name', [item({ name: 'x'.repeat(101) })], /name/);
bad('a control char in the name', [item({ name: 'a\nb' })], /name/);
bad('a non-string name', [item({ name: 5 })], /name/);
bad('amount 49', [item({ amountCents: 49 })], /amountCents/);
bad('amount 100000000', [item({ amountCents: 100000000 })], /amountCents/);
bad('a fractional amount', [item({ amountCents: 99.5 })], /amountCents/);
bad('a string amount', [item({ amountCents: '999' })], /amountCents/);
bad('a currency outside the allowlist', [item({ currency: 'jpy' })], /currency/);
bad('an uppercase currency', [item({ currency: 'USD' })], /currency/);
bad('an unknown mode', [item({ mode: 'setup' })], /mode/);
bad('a subscription without interval', [item({ mode: 'subscription' })], /interval/);
bad('a subscription with a bad interval', [item({ mode: 'subscription', interval: 'fortnight' })], /interval/);
bad('an interval on a one-time item', [item({ interval: 'month' })], /interval/);
bad('maxQuantity 0', [item({ maxQuantity: 0 })], /maxQuantity/);
bad('maxQuantity 101', [item({ maxQuantity: 101 })], /maxQuantity/);
bad('a fractional maxQuantity', [item({ maxQuantity: 1.5 })], /maxQuantity/);
bad('an unknown field (typo for amountCents)', [item({ price: 5 })], /unknown field/);

test('maxQuantity 100 is accepted', () => assert.equal(validateCatalog([item({ maxQuantity: 100 })]).ok, true));
test('prototype-polluting ids do not slip through', () => assert.equal(validateCatalog([item({ id: '__proto__' })]).ok, false));

test('the manifest validator accepts a pay-only manifest and rejects an invalid catalog inside it', () => {
    assert.deepEqual(validateManifest({ pay: { catalog: [item()] } }), { ok: true, problems: [] });
    assert.deepEqual(validateManifest({ connectors: {}, pay: { catalog: [item()] } }), { ok: true, problems: [] });
    const r = validateManifest({ pay: { catalog: [item({ amountCents: 1 })] } });
    assert.equal(r.ok, false); assert.match(r.problems.join('|'), /pay.*amountCents/);
    assert.equal(validateManifest({ pay: { catalog: [item()], extra: 1 } }).ok, false);
    assert.equal(validateManifest({ pay: 'x' }).ok, false);
    assert.equal(validateManifest({}).ok, false);
});

test('validatePay is not ok when the catalog is valid but an unknown field is present, or the catalog is invalid', () => {
    assert.equal(validatePay({ catalog: [item()] }).ok, true);
    assert.equal(validatePay({ catalog: [item()], extra: 1 }).ok, false);
    assert.equal(validatePay({ catalog: [] }).ok, false);
    assert.equal(validatePay(null).ok, false);
    assert.equal(validatePay([]).ok, false);
});

test('connectors, when present, must still be an object, with or without pay', () => {
    const msg = ['manifest must be an object with a connectors object'];
    for (const c of ['x', [], null, 5]) {
        assert.deepEqual(validateManifest({ pay: { catalog: [item()] }, connectors: c }), { ok: false, problems: msg }, JSON.stringify(c));
    }
    assert.deepEqual(validateManifest({ connectors: 'x' }), { ok: false, problems: msg });
    assert.deepEqual(validateManifest({ connectors: null }), { ok: false, problems: msg });
    assert.deepEqual(validateManifest({}), { ok: false, problems: msg });
    assert.deepEqual(validateManifest(null), { ok: false, problems: msg });
});
