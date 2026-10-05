import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContent, buildMessage, MAX_SUBJECT, MAX_TEXT } from '../content.js';

test('limits are 120 and 2000', () => { assert.equal(MAX_SUBJECT, 120); assert.equal(MAX_TEXT, 2000); });

test('accepts a normal message and returns cleaned strings', () => {
    assert.deepEqual(validateContent({ subject: 'Your order shipped', text: 'Line one\nLine two' }), { ok: true, subject: 'Your order shipped', text: 'Line one\nLine two' });
});

test('subject: CR and LF can never survive, so no header can be injected', () => {
    for (const s of ['Hi\r\nBcc: evil@example.com', 'Hi\nBcc: x', 'Hi\rBcc: x', 'a\u2028b', 'a\u2029b', 'a\u0000b', 'a\u0085b']) {
        const r = validateContent({ subject: s, text: 'x' });
        assert.equal(r.ok, true, s);
        assert.equal(/[\r\n\u0000\u0085\u2028\u2029]/.test(r.subject), false, JSON.stringify(r.subject));
    }
    assert.equal(validateContent({ subject: 'Hi\r\nBcc: x', text: 'x' }).subject, 'Hi Bcc: x');
});

test('subject: trimmed, length counted after cleaning, 120 allowed and 121 refused', () => {
    assert.equal(validateContent({ subject: '  padded  ', text: 'x' }).subject, 'padded');
    assert.equal(validateContent({ subject: 'a'.repeat(120), text: 'x' }).ok, true);
    assert.deepEqual(validateContent({ subject: 'a'.repeat(121), text: 'x' }), { ok: false, reason: 'invalid_content', detail: 'subject_too_long' });
    assert.equal(validateContent({ subject: 'a'.repeat(120) + '   ', text: 'x' }).ok, true); // trailing space is trimmed before counting
});

test('subject: must be a non-empty string', () => {
    for (const s of ['', '   ', '\r\n', undefined, null, 5, {}, ['a']]) assert.deepEqual(validateContent({ subject: s, text: 'x' }), { ok: false, reason: 'invalid_content', detail: 'subject_required' }, String(s));
});

test('text: 2000 allowed, 2001 refused, must be a non-empty string', () => {
    assert.equal(validateContent({ subject: 's', text: 'a'.repeat(2000) }).ok, true);
    assert.deepEqual(validateContent({ subject: 's', text: 'a'.repeat(2001) }), { ok: false, reason: 'invalid_content', detail: 'text_too_long' });
    for (const t of ['', '  \n ', undefined, null, 7, {}]) assert.deepEqual(validateContent({ subject: 's', text: t }), { ok: false, reason: 'invalid_content', detail: 'text_required' }, String(t));
});

test('text: CR is dropped, tab and newline kept, other control characters refused', () => {
    assert.equal(validateContent({ subject: 's', text: 'a\r\nb\tc' }).text, 'a\nb\tc');
    for (const c of ['\u0000', '\u0007', '\u001b', '\u007f', '\u000b', '\u000c']) assert.deepEqual(validateContent({ subject: 's', text: `a${c}b` }), { ok: false, reason: 'invalid_content', detail: 'text_control_chars' }, JSON.stringify(c));
});

test('text keeps non-ASCII characters (only the platform footer is ASCII-only)', () => {
    assert.equal(validateContent({ subject: 'café', text: 'naïve ✓' }).text, 'naïve ✓');
});

test('missing or non-object input is refused', () => {
    for (const v of [undefined, null, 'x', 5]) assert.equal(validateContent(v).ok, false);
});

test('buildMessage: appends a fixed footer naming the app and the unsubscribe link, and sets list headers', () => {
    const url = 'https://vibe-proxy.test/my-app/notify/unsubscribe?t=abc.def';
    const m = buildMessage({ appId: 'my-app', subject: 'Hello', text: 'Body text', unsubscribeUrl: url });
    assert.equal(m.subject, 'Hello');
    assert.ok(m.text.startsWith('Body text\n'));
    assert.match(m.text, /my-app/); assert.ok(m.text.includes(url));
    assert.match(m.text, /stop receiving/i);
    assert.equal(m.headers['List-Unsubscribe'], `<${url}>`);
    assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.equal(/[^\x00-\x7f]/.test(m.text.slice('Body text'.length)), false); // footer is plain ASCII
});

test('buildMessage: the footer cannot be pushed off or altered by the body, and headers have no CR or LF', () => {
    const m = buildMessage({ appId: 'x', subject: 's', text: 'y'.repeat(2000), unsubscribeUrl: 'https://p.test/x/notify/unsubscribe?t=1.2' });
    assert.ok(m.text.endsWith('t=1.2\n') || m.text.endsWith('t=1.2'));
    for (const v of Object.values(m.headers)) assert.equal(/[\r\n]/.test(v), false);
});

test('buildMessage refuses an app id or url that could break the footer or headers', () => {
    assert.throws(() => buildMessage({ appId: 'Bad App', subject: 's', text: 't', unsubscribeUrl: 'https://p.test/x' }));
    assert.throws(() => buildMessage({ appId: 'ok', subject: 's', text: 't', unsubscribeUrl: 'https://p.test/x\r\nBcc: a@b.c' }));
    assert.throws(() => buildMessage({ appId: 'ok', subject: 's', text: 't', unsubscribeUrl: 'http://p.test/x' }));
    assert.throws(() => buildMessage({ appId: 'ok', subject: 's', text: 't', unsubscribeUrl: 'https://p.test/x>' }));
});
