import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PASSWORD_LENGTH, recoveryRedirectUrl, validateNewPassword, resetLinkProblem } from './passwordReset.ts';

test('the reset link comes back to /reset on the same origin', () => {
  assert.equal(recoveryRedirectUrl('https://vibebuild.cc'), 'https://vibebuild.cc/reset');
  assert.equal(recoveryRedirectUrl('http://localhost:3000'), 'http://localhost:3000/reset');
  assert.equal(recoveryRedirectUrl('https://vibebuild.cc/'), 'https://vibebuild.cc/reset');
});

test('minimum length matches the sign-up form (6)', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 6);
});

test('validateNewPassword: too short, mismatch, ok', () => {
  assert.equal(validateNewPassword('abc', 'abc'), 'tooShort');
  assert.equal(validateNewPassword('', ''), 'tooShort');
  assert.equal(validateNewPassword('abcdef', 'abcdeg'), 'mismatch');
  assert.equal(validateNewPassword('abcdef', 'abcdef'), null);
});

test('validateNewPassword checks length before comparing, and does not trim', () => {
  assert.equal(validateNewPassword('abc', 'xyz'), 'tooShort');
  assert.equal(validateNewPassword(' abcde ', ' abcde '), null);
  assert.equal(validateNewPassword('abcdef ', 'abcdef'), 'mismatch');
});

test('resetLinkProblem: no problem on a clean URL or a PKCE code', () => {
  assert.equal(resetLinkProblem('', ''), null);
  assert.equal(resetLinkProblem('?code=abc123', ''), null);
});

test('resetLinkProblem: flags an expired or denied link from the query or the hash', () => {
  assert.equal(resetLinkProblem('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), 'expired');
  assert.equal(resetLinkProblem('?error=access_denied&error_code=otp_expired', ''), 'expired');
  assert.equal(resetLinkProblem('?error_description=anything', ''), 'invalid');
  assert.equal(resetLinkProblem('', '#error=server_error'), 'invalid');
});
