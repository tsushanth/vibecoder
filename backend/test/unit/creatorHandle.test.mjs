import test from 'node:test';
import assert from 'node:assert/strict';
import { publicCreatorName, withPublicCreator } from '../../lib/creatorHandle.js';

test('a full name becomes first name plus initial', () => {
    assert.equal(publicCreatorName('Sam Taylor', 'u1'), 'Sam T.');
    assert.equal(publicCreatorName('Maria de la Cruz', 'u1'), 'Maria C.');
    assert.equal(publicCreatorName('  Ana   María  López ', 'u1'), 'Ana L.');
    assert.equal(publicCreatorName('ahmed al-sayed', 'u1'), 'ahmed A.');
});

test('a single plain first name is kept', () => {
    assert.equal(publicCreatorName('Priya', 'u1'), 'Priya');
});

test('an email, or the part of one, never comes through', () => {
    for (const bad of ['sam@example.com', 'john.smith92', 'puzzleverseai+vbtest1101', 'user_123', 'xX_dragon_Xx', '12345']) {
        const out = publicCreatorName(bad, 'u1');
        assert.match(out, /^builder-[0-9a-f]{6}$/, bad);
    }
    assert.match(publicCreatorName('Sam Taylor sam@example.com', 'u1'), /^builder-/);
});

test('the fallback handle is stable per user and differs between users', () => {
    assert.equal(publicCreatorName('', 'user-a'), publicCreatorName(null, 'user-a'));
    assert.notEqual(publicCreatorName('', 'user-a'), publicCreatorName('', 'user-b'));
    assert.match(publicCreatorName(undefined, undefined), /^builder-[0-9a-f]{6}$/);
});

test('a long first name is cut', () => {
    assert.ok(publicCreatorName('A'.repeat(80) + ' Smith', 'u').length <= 24);
});

test('the full name is not in the output for any multi-word name', () => {
    const out = publicCreatorName('Jonathan Featherstonehaugh', 'u');
    assert.equal(out, 'Jonathan F.');
    assert.ok(!out.includes('Featherstonehaugh'));
});

test('withPublicCreator replaces only creator_name and leaves the input alone', () => {
    const row = { id: 1, creator_id: 'u1', creator_name: 'Sam Taylor', title: 'x' };
    const out = withPublicCreator(row);
    assert.equal(out.creator_name, 'Sam T.');
    assert.equal(out.title, 'x');
    assert.equal(row.creator_name, 'Sam Taylor');
    assert.equal(withPublicCreator(null), null);
});
