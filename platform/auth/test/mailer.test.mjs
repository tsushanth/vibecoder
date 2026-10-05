import test from 'node:test';
import assert from 'node:assert/strict';
import { createResendMailer } from '../mailer.js';

const rig = (status = 200) => { const calls = []; return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response('{}', { status }); } }; };

test('posts one email to Resend with the key as a bearer token and the link in the text', async () => {
    const r = rig(); const m = createResendMailer({ apiKey: 're_testkey12345', from: 'Vibe <login@mail.vibebuild.cc>', fetchImpl: r.fetchImpl });
    await m.send({ to: 'a@example.com', appId: 'my-app', link: 'https://my-app.vibebuild.cc/?vibe_login=tok' });
    assert.equal(r.calls.length, 1); assert.equal(r.calls[0].url, 'https://api.resend.com/emails');
    assert.equal(r.calls[0].init.headers.Authorization, 'Bearer re_testkey12345'); assert.equal(r.calls[0].init.redirect, 'manual');
    const b = JSON.parse(r.calls[0].init.body);
    assert.deepEqual(b.to, ['a@example.com']); assert.equal(b.from, 'Vibe <login@mail.vibebuild.cc>');
    assert.match(b.text, /https:\/\/my-app\.vibebuild\.cc\/\?vibe_login=tok/); assert.match(b.text, /my-app/);
    assert.equal(/[^\x00-\x7f]/.test(b.subject + b.text), false);
});

test('a provider refusal rejects without leaking the key or the link', async () => {
    const m = createResendMailer({ apiKey: 're_testkey12345', from: 'login@mail.vibebuild.cc', fetchImpl: rig(422).fetchImpl });
    await assert.rejects(() => m.send({ to: 'a@example.com', appId: 'x', link: 'https://x/?t=SECRETLINK' }), (e) => /422/.test(e.message) && !/SECRETLINK|re_testkey/.test(e.message));
});

test('a hung provider is aborted by the timeout', async () => {
    const m = createResendMailer({ apiKey: 're_testkey12345', from: 'login@mail.vibebuild.cc', timeoutMs: 20, fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
    await assert.rejects(() => m.send({ to: 'a@example.com', appId: 'x', link: 'l' }), /aborted/);
});

test('construction rejects a missing key or a bad from address', () => {
    for (const apiKey of [undefined, '', 'short']) assert.throws(() => createResendMailer({ apiKey, from: 'a@b.com' }));
    for (const from of [undefined, '', 'not an address', 'a@b.com\r\nBcc: x@y.com', '<>']) assert.throws(() => createResendMailer({ apiKey: 're_testkey12345', from }), String(from));
});

test('sendMessage posts the given subject, text and headers to Resend with the platform from address', async () => {
    const r = rig(); const m = createResendMailer({ apiKey: 're_testkey12345', from: 'Vibe <login@mail.vibebuild.cc>', fetchImpl: r.fetchImpl });
    await m.sendMessage({ to: 'u@example.com', subject: 'Hi there', text: 'Body', headers: { 'List-Unsubscribe': '<https://p.test/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
    assert.equal(r.calls.length, 1); assert.equal(r.calls[0].url, 'https://api.resend.com/emails');
    assert.equal(r.calls[0].init.headers.Authorization, 'Bearer re_testkey12345'); assert.equal(r.calls[0].init.redirect, 'manual'); assert.equal(r.calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(r.calls[0].init.body), { from: 'Vibe <login@mail.vibebuild.cc>', to: ['u@example.com'], subject: 'Hi there', text: 'Body', headers: { 'List-Unsubscribe': '<https://p.test/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
});

test('sendMessage without headers sends none', async () => {
    const r = rig(); const m = createResendMailer({ apiKey: 're_testkey12345', from: 'login@mail.vibebuild.cc', fetchImpl: r.fetchImpl });
    await m.sendMessage({ to: 'u@example.com', subject: 's', text: 't' });
    assert.equal('headers' in JSON.parse(r.calls[0].init.body), false);
});

test('sendMessage refuses CR or LF in the recipient, subject or any header, and sends nothing', async () => {
    const r = rig(); const m = createResendMailer({ apiKey: 're_testkey12345', from: 'login@mail.vibebuild.cc', fetchImpl: r.fetchImpl });
    const bad = [
        { to: 'a@example.com\r\nBcc: x@y.com', subject: 's', text: 't' },
        { to: 'a@example.com', subject: 's\r\nBcc: x@y.com', text: 't' },
        { to: 'a@example.com', subject: 's\nX', text: 't' },
        { to: 'a@example.com', subject: 's', text: 't', headers: { 'X-A': 'v\r\nBcc: x@y.com' } },
        { to: 'a@example.com', subject: 's', text: 't', headers: { 'X-A\r\nBcc': 'v' } },
        { to: ['a@example.com'], subject: 's', text: 't' },
        { to: 'a@example.com', subject: '', text: 't' },
        { to: 'a@example.com', subject: 's', text: '' },
    ];
    for (const b of bad) await assert.rejects(() => m.sendMessage(b), JSON.stringify(b));
    assert.equal(r.calls.length, 0);
});

test('sendMessage refuses a bare CR, and anything but exactly one plain address', async () => {
    const r = rig(); const m = createResendMailer({ apiKey: 're_testkey12345', from: 'login@mail.vibebuild.cc', fetchImpl: r.fetchImpl });
    for (const b of [
        { to: 'a@example.com', subject: 's\rX', text: 't' },
        { to: 'a@example.com', subject: 's', text: 't', headers: { 'X-A': 'v\rX' } },
        { to: 'a b@example.com', subject: 's', text: 't' },
        { to: 'a@example.com,b@example.com', subject: 's', text: 't' },
        { to: 'A <a@example.com>', subject: 's', text: 't' },
        { to: 'a@example.com;b@example.com', subject: 's', text: 't' },
        { to: 'nobody', subject: 's', text: 't' },
    ]) await assert.rejects(() => m.sendMessage(b), JSON.stringify(b));
    assert.equal(r.calls.length, 0);
});

test('sendMessage: a provider refusal rejects without leaking the key or the message', async () => {
    const m = createResendMailer({ apiKey: 're_testkey12345', from: 'login@mail.vibebuild.cc', fetchImpl: rig(500).fetchImpl });
    await assert.rejects(() => m.sendMessage({ to: 'a@example.com', subject: 's', text: 'PRIVATEBODY' }), (e) => /500/.test(e.message) && !/PRIVATEBODY|re_testkey/.test(e.message));
});

test('sendMessage: a hung provider is aborted by the timeout', async () => {
    const m = createResendMailer({ apiKey: 're_testkey12345', from: 'login@mail.vibebuild.cc', timeoutMs: 20, fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
    await assert.rejects(() => m.sendMessage({ to: 'a@example.com', subject: 's', text: 't' }), /aborted/);
});
