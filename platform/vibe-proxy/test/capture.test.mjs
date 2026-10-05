import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSecrets } from '../capture.js';

const j = (...p) => p.join('');
const GOOGLE = j('AIza', 'SyA1234567890abcdefghijklmnopqrstuv');
const OPENAI = j('sk-', 'proj-abcdefghijklmnopqrstuvwxyz123456');
const OPENROUTER = j('sk-', 'or-v1-abcdefghijklmnopqrstuvwxyz0123456789');
const ANTHROPIC = j('sk-', 'ant-api03-abcdefghijklmnopqrstuvwxyz012345');
const GITHUB = j('gh', 'p_abcdefghijklmnopqrstuvwxyz0123456789');
const STRIPE = j('sk_', 'live_abcdefghijklmnopqrstuv1234');
const AWS = j('AK', 'IAABCDEFGHIJKLMNOP');
const GEMINI = j('AQ', '.Zz9FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfake12');
const JWT = j('ey', 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.', 'eyJpc3MiOiJzdXBhYmFzZSJ9.', 'abcdefghijklmnop');

const cases = [['a Google API key', GOOGLE, 'GOOGLE_API_KEY'], ['an OpenAI style key', OPENAI, 'OPENAI_API_KEY'], ['an OpenRouter key', OPENROUTER, 'OPENROUTER_API_KEY'], ['an Anthropic key', ANTHROPIC, 'ANTHROPIC_API_KEY'],
    ['a GitHub token', GITHUB, 'GITHUB_TOKEN'], ['a Stripe live key', STRIPE, 'STRIPE_SECRET_KEY'], ['an AWS access key id', AWS, 'AWS_ACCESS_KEY_ID'], ['a Gemini token', GEMINI, 'GEMINI_API_KEY'], ['a JWT', JWT, 'JWT_TOKEN']];
for (const [label, value, name] of cases) {
    test(`extracts ${label}, names it ${name}, and removes the value from the text`, () => {
        const r = extractSecrets(`Build a chatbot, my key is ${value} please use it`);
        assert.deepEqual(r.found, [{ name, value, kind: r.found[0].kind }]);
        assert.equal(r.text.includes(value), false);
        assert.equal(r.text, `Build a chatbot, my key is [SECRET:${name}] please use it`);
    });
}

test('extracts a long value assigned to a key-like word in plain language', () => {
    const v = ['q8Zr2LmPv9', 'Xc4Tb7Nw1E', 'd6Hy3Ks0Ja', '5U'].join('');
    for (const text of [`api key: ${v}`, `my API KEY is ${v}`, `API_KEY=${v}`, `the secret = "${v}"`]) {
        const r = extractSecrets(text);
        assert.equal(r.found.length, 1, text); assert.equal(r.found[0].value, v); assert.equal(r.text.includes(v), false, text);
    }
    assert.equal(extractSecrets(`api key: ${v}`).found[0].name, 'API_KEY');
    assert.equal(extractSecrets(`the secret = "${v}"`).found[0].name, 'SECRET');
    assert.equal(extractSecrets(`access token ${v}`).found[0].name, 'TOKEN');
    assert.equal(extractSecrets(`password: ${v}`).found[0].name, 'PASSWORD');
});

test('the same value used twice gets one entry and one placeholder', () => {
    const r = extractSecrets(`use ${GOOGLE} here and ${GOOGLE} there`);
    assert.equal(r.found.length, 1); assert.equal(r.text, 'use [SECRET:GOOGLE_API_KEY] here and [SECRET:GOOGLE_API_KEY] there');
});

test('two different keys of the same kind get numbered names', () => {
    const other = j('AIza', 'SyB9999999999abcdefghijklmnopqrstu');
    const r = extractSecrets(`first ${GOOGLE} second ${other}`);
    assert.deepEqual(r.found.map((f) => f.name), ['GOOGLE_API_KEY', 'GOOGLE_API_KEY_2']);
    assert.equal(r.text, 'first [SECRET:GOOGLE_API_KEY] second [SECRET:GOOGLE_API_KEY_2]');
});

test('names already in the vault are not reused', () => {
    const r = extractSecrets(`key ${GOOGLE}`, { existingNames: ['GOOGLE_API_KEY', 'GOOGLE_API_KEY_2'] });
    assert.equal(r.found[0].name, 'GOOGLE_API_KEY_3');
});

test('several different kinds in one message are all extracted', () => {
    const r = extractSecrets(`openai ${OPENAI} and stripe ${STRIPE} and github ${GITHUB}`);
    assert.deepEqual(r.found.map((f) => f.name).sort(), ['GITHUB_TOKEN', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY']);
    for (const f of r.found) assert.equal(r.text.includes(f.value), false);
});

test('ordinary prompts are returned unchanged with nothing found', () => {
    for (const clean of ['Build a tiny todo list app with add and delete', 'a weather app with a 5-day forecast and an api key input field', 'password strength meter with a show password toggle',
        'token bucket rate limiter in JavaScript', 'my secret santa organiser for the office', 'Enter your API key below and press Save', 'a game like fortnite. a gun game', 'api key: abc', 'the token authentication-middleware-implementation-details are explained', 'read the api key setupInstructionsForTheNewDeveloper first', 'use the sk-learn library for the model', 'the AKIAHOLD project plan', 'password: correct-horse-battery-staple-words']) {
        const r = extractSecrets(clean);
        assert.deepEqual(r, { text: clean, found: [] }, clean);
    }
});

test('running it on already-extracted text finds nothing more', () => {
    const once = extractSecrets(`key ${GOOGLE} and ${STRIPE}`);
    assert.deepEqual(extractSecrets(once.text), { text: once.text, found: [] });
});

test('every found name is a valid vault secret name', () => {
    const r = extractSecrets(`${GOOGLE} ${OPENAI} ${OPENROUTER} ${ANTHROPIC} ${GITHUB} ${STRIPE} ${AWS} ${GEMINI} ${JWT} api key: ${['q8Zr2LmPv9', 'Xc4Tb7Nw1E', 'd6Hy3Ks0Ja', '5U'].join('')}`);
    assert.ok(r.found.length >= 9);
    for (const f of r.found) assert.match(f.name, /^[A-Z][A-Z0-9_]{1,63}$/);
});

test('non-string input is returned safely', () => {
    assert.deepEqual(extractSecrets(undefined), { text: '', found: [] });
    assert.deepEqual(extractSecrets(null), { text: '', found: [] });
});

test('found entries expose the value only in the value field', () => {
    const r = extractSecrets(`k ${GOOGLE}`);
    const copy = { ...r.found[0], value: undefined };
    assert.equal(JSON.stringify(copy).includes(GOOGLE), false);
});

test('only the value is replaced; the surrounding words, punctuation and quotes stay', () => {
    const v = ['q8Zr2LmPv9', 'Xc4Tb7Nw1E', 'd6Hy3Ks0Ja', '5U'].join('');
    assert.equal(extractSecrets(`api key: ${v}`).text, 'api key: [SECRET:API_KEY]');
    assert.equal(extractSecrets(`my API KEY is ${v} ok`).text, 'my API KEY is [SECRET:API_KEY] ok');
    assert.equal(extractSecrets(`the secret = "${v}"`).text, 'the secret = "[SECRET:SECRET]"');
});
