import test from 'node:test';
import assert from 'node:assert/strict';
import { vibeProblems, VIBE_RULES } from '../../lib/vibe.js';
import { staticChecks } from '../../lib/checks.js';

const page = (js, head = '<script src="vibe.js"></script>') => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">${head}</head><body><!--${'x'.repeat(250)}--><button onclick="go()">Go</button><script>${js}</script></body></html>`;
const AUTH = 'vibe.auth.ready.then(function(){ return vibe.auth.user(); });';
const SEND = 'vibe.notify.me({ subject: "Reminder", text: "Drink water" }).catch(function (e) { show(e.status); });';
const app = (js) => ({ 'index.html': page(js) });
const one = (files, re) => {
    const p = vibeProblems(files, { enabled: true });
    assert.equal(p.length, 1, p.join(' | '));
    assert.match(p[0], re);
    return p[0];
};

test('notify with vibe.auth is fine, and staticChecks agrees', () => {
    assert.deepEqual(vibeProblems(app(`${AUTH}${SEND}`), { enabled: true }), []);
    assert.equal(staticChecks(app(`${AUTH}${SEND}`), { vibe: true }).ok, true);
});
test('notify without vibe.auth is a problem: the email goes to the signed-in user only', () => {
    one(app(SEND), /vibe\.notify.*vibe\.auth/s);
});
test('vibe.auth in a separate file satisfies the notify rule', () => {
    assert.deepEqual(vibeProblems({ 'index.html': page(SEND), 'app.js': AUTH }, { enabled: true }), []);
});
test('a model-written vibe.js does not count as using auth', () => {
    one({ 'index.html': page(SEND), 'vibe.js': 'vibe.auth = 1;' }, /vibe\.notify.*vibe\.auth/s);
});
test('there is no way to name a recipient: to, email, recipient, cc, bcc, from, address are problems', () => {
    for (const k of ['to', 'email', 'recipient', 'cc', 'bcc', 'from', 'address', 'user']) {
        const m = one(app(`${AUTH}vibe.notify.me({ subject: "a", text: "b", ${k}: "x@y.co" })`), /only (?:a )?subject and text/);
        assert.match(m, new RegExp(`"${k}"`));
    }
    assert.deepEqual(vibeProblems(app(`${AUTH}vibe.notify.me({ subject: "a", text: "b" })`), { enabled: true }), []);
    assert.deepEqual(vibeProblems(app(`${AUTH}vibe.notify.me({ "subject": s, 'text': t })`), { enabled: true }), []);
});
test('a literal subject over 120 characters or text over 2000 is a problem; exactly at the limit is fine', () => {
    one(app(`${AUTH}vibe.notify.me({ subject: "${'s'.repeat(121)}", text: "b" })`), /subject.*120/);
    one(app(`${AUTH}vibe.notify.me({ subject: "a", text: "${'t'.repeat(2001)}" })`), /text.*2000/);
    assert.deepEqual(vibeProblems(app(`${AUTH}vibe.notify.me({ subject: "${'s'.repeat(120)}", text: "${'t'.repeat(2000)}" })`), { enabled: true }), []);
});
test('a literal empty subject or text is a problem', () => {
    one(app(`${AUTH}vibe.notify.me({ subject: "", text: "b" })`), /subject.*not (?:be )?empty|empty.*subject/i);
    one(app(`${AUTH}vibe.notify.me({ subject: "a", text: "  " })`), /text.*not (?:be )?empty|empty.*text/i);
});
test('non-literal arguments are not guessed at', () => {
    assert.deepEqual(vibeProblems(app(`${AUTH}var o = { subject: s, text: t }; vibe.notify.me(o); vibe.notify.me({ subject: "Hi " + n, text: t });`), { enabled: true }), []);
});
test('notify does not need a schema, a manifest or pay', () => {
    assert.deepEqual(vibeProblems(app(`${AUTH}${SEND}`), { enabled: true }), []);
});
test('the rules teach notifications: self only, auth, limits, 429/401, no promises about other people', () => {
    for (const re of [
        /vibe\.notify\.me\(\{ ?subject, ?text ?\}\)/,
        /only (?:ever )?emails? the signed-in user (?:themself|themselves|at their own address)/i,
        /requires? vibe\.auth|needs? vibe\.auth|use vibe\.auth/i,
        /subject.{0,30}120/i, /text.{0,30}2000/i,
        /429/, /401/, /opted_out/,
        /never (?:promise|say|claim).{0,80}(?:other people|anyone else|someone else)/i,
        /plain text/i,
    ]) assert.match(VIBE_RULES, re);
});
