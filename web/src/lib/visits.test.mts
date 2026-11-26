import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NO_VISITS, ownerHref, parseVisits } from './visits.ts';
import { SUPPORTED_LOCALES } from '../i18n/locales.ts';

const app = { projectId: 'p1', url: 'https://my-app.vibebuild.cc', openUrl: 'https://my-app.vibebuild.cc/?vb_own=1.x', today: 0, last7Days: 3, total: 9 };

test('counts are read per project; a malformed entry is left out rather than shown as zero', () => {
  const v = parseVisits({ countingSince: '2026-11-26', apps: [app, { ...app, projectId: 'p2', total: undefined }, { ...app, projectId: 'p3', openUrl: 'javascript:alert(1)' }, null] });
  assert.deepEqual(Object.keys(v.apps), ['p1']);
  assert.equal(v.apps.p1.last7Days, 3);
  assert.equal(v.countingSince, '2026-11-26');
  for (const bad of [null, 'x', {}, { apps: 'x' }]) assert.deepEqual(parseVisits(bad), NO_VISITS);
});

test('the signed address is only used for the same site', () => {
  const v = parseVisits({ apps: [app] }).apps.p1;
  assert.equal(ownerHref('https://my-app.vibebuild.cc', v), app.openUrl);
  assert.equal(ownerHref('https://other.vibebuild.cc', v), 'https://other.vibebuild.cc');
  assert.equal(ownerHref('https://my-app.vibebuild.cc', undefined), 'https://my-app.vibebuild.cc');
});

test('every language has the visit strings with the same placeholders', () => {
  const read = (l: string) => JSON.parse(readFileSync(new URL(`../i18n/messages/parts/apps.${l}.json`, import.meta.url), 'utf8')).apps.visits;
  const holes = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
  const en = read('en');
  for (const l of SUPPORTED_LOCALES) {
    const m = read(l);
    assert.deepEqual(Object.keys(m).sort(), Object.keys(en).sort(), l);
    for (const k of Object.keys(en)) assert.deepEqual(holes(m[k]), holes(en[k]), `${l}.${k}`);
  }
});
