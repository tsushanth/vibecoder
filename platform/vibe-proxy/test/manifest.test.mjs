import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../manifest.js';

const good = () => ({
    connectors: {
        weather: { host: 'api.open-meteo.com', paths: ['/v1/forecast'], methods: ['GET'] },
        sheets: { host: 'sheets.googleapis.com', paths: ['/v4/spreadsheets/*'], methods: ['GET', 'POST'], secret: { name: 'SHEETS_KEY', in: 'query', field: 'key' } },
    },
});

test('accepts a valid manifest', () => {
    assert.deepEqual(validateManifest(good()), { ok: true, problems: [] });
});

test('rejects a non-object manifest', () => {
    assert.equal(validateManifest(null).ok, false);
    assert.equal(validateManifest('x').ok, false);
    assert.equal(validateManifest({}).ok, false);
});

const bad = (name, mutate, re) => test(`rejects ${name}`, () => {
    const m = good(); mutate(m);
    const r = validateManifest(m);
    assert.equal(r.ok, false);
    assert.match(r.problems.join(' | '), re);
});

bad('an invalid connector name', (m) => { m.connectors['Bad Name!'] = m.connectors.weather; }, /connector name/i);
bad('an ip address as host', (m) => { m.connectors.weather.host = '8.8.8.8'; }, /host/i);
bad('an internal host', (m) => { m.connectors.weather.host = 'db.internal'; }, /host/i);
bad('a host with a scheme or path', (m) => { m.connectors.weather.host = 'https://api.open-meteo.com/x'; }, /host/i);
bad('a host with a port', (m) => { m.connectors.weather.host = 'api.example.com:8443'; }, /host/i);
bad('a path without a leading slash', (m) => { m.connectors.weather.paths = ['v1/forecast']; }, /path/i);
bad('a path with dot segments', (m) => { m.connectors.weather.paths = ['/v1/../admin']; }, /path/i);
bad('a wildcard in the middle of a path', (m) => { m.connectors.weather.paths = ['/v1/*/forecast']; }, /path/i);
bad('an empty paths list', (m) => { m.connectors.weather.paths = []; }, /path/i);
bad('an unknown method', (m) => { m.connectors.weather.methods = ['TRACE']; }, /method/i);
bad('no methods', (m) => { m.connectors.weather.methods = []; }, /method/i);
bad('a secret placed in an unknown location', (m) => { m.connectors.sheets.secret.in = 'cookie'; }, /secret/i);
bad('a secret with no field', (m) => { delete m.connectors.sheets.secret.field; }, /secret/i);
bad('a secret header that would override Host', (m) => { m.connectors.sheets.secret = { name: 'K', in: 'header', field: 'Host' }; }, /secret/i);
bad('a secret name that is not an upper snake identifier', (m) => { m.connectors.sheets.secret.name = 'my key'; }, /secret/i);
bad('too many connectors', (m) => { for (let i = 0; i < 25; i++) m.connectors[`c${i}`] = m.connectors.weather; }, /too many/i);

test('reports every problem, not just the first', () => {
    const m = good();
    m.connectors.weather.host = '8.8.8.8'; m.connectors.weather.methods = ['TRACE'];
    assert.ok(validateManifest(m).problems.length >= 2);
});
