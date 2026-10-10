import '../helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { actorStatus, denyUnlessActor } from '../../lib/actAs.js';

const req = {};
const verifyAs = (id) => async () => id;
const db = (impl) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: impl }) }) }) });
const realAccount = db(async () => ({ data: { email: 'a@example.com' }, error: null }));
const anonymous = db(async () => ({ data: { email: null }, error: null }));

test('a verified token for the same user is ok, and the database is not consulted', async () => {
    let looked = 0; const c = db(async () => { looked++; return { data: null, error: null }; });
    assert.equal(await actorStatus(req, 'u1', { verifyUser: verifyAs('u1'), client: c }), 'ok');
    assert.equal(looked, 0);
});

test('a verified token for a different user is forbidden, even when the claimed id is an anonymous device id', async () => {
    assert.equal(await actorStatus(req, 'victim', { verifyUser: verifyAs('attacker'), client: realAccount }), 'forbidden');
    assert.equal(await actorStatus(req, 'victim', { verifyUser: verifyAs('attacker'), client: anonymous }), 'forbidden');
});

test('no token: a real account needs to sign in, an anonymous device id carries on', async () => {
    assert.equal(await actorStatus(req, 'u1', { verifyUser: verifyAs(null), client: realAccount }), 'unauthenticated');
    assert.equal(await actorStatus(req, 'device-1', { verifyUser: verifyAs(null), client: anonymous }), 'ok');
    assert.equal(await actorStatus(req, 'never-registered', { verifyUser: verifyAs(null), client: db(async () => ({ data: null, error: null })) }), 'ok');
});

test('fails closed: a lookup error or a throw never lets an unverified caller through', async () => {
    assert.equal(await actorStatus(req, 'u1', { verifyUser: verifyAs(null), client: db(async () => ({ data: null, error: { message: 'down' } })) }), 'unauthenticated');
    assert.equal(await actorStatus(req, 'u1', { verifyUser: verifyAs(null), client: db(async () => { throw new Error('boom'); }) }), 'unauthenticated');
});

test('a missing or non-string user id is forbidden without any lookup', async () => {
    for (const id of [undefined, null, '', 42, {}, ['u1']]) assert.equal(await actorStatus(req, id, { verifyUser: verifyAs('u1'), client: realAccount }), 'forbidden');
});

test('denyUnlessActor answers 401 or 403 and returns true, and stays silent and returns false when allowed', async () => {
    const mk = () => { const r = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; return r; };
    let r = mk(); assert.equal(await denyUnlessActor(req, r, 'u1', { verifyUser: verifyAs(null), client: realAccount }), true); assert.equal(r.code, 401);
    r = mk(); assert.equal(await denyUnlessActor(req, r, 'u1', { verifyUser: verifyAs('u2'), client: realAccount }), true); assert.equal(r.code, 403);
    r = mk(); assert.equal(await denyUnlessActor(req, r, 'u1', { verifyUser: verifyAs('u1'), client: realAccount }), false); assert.equal(r.code, null);
});
