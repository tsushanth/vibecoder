import test from 'node:test';
import assert from 'node:assert/strict';
import { autoRetryEnabled, autoRetryDelayMs, shouldAutoRetry, autoRetryMarker } from '../../lib/autoRetry.js';

const ON = { BUILD_AUTO_RETRY: '1' };
const base = { cls: 'WORKER_ERROR', flag: '1', projectStatus: 'building', hasPrompt: true };

test('off unless BUILD_AUTO_RETRY is exactly 1', () => {
    assert.equal(autoRetryEnabled({}), false);
    assert.equal(autoRetryEnabled({ BUILD_AUTO_RETRY: 'true' }), false);
    assert.equal(autoRetryEnabled(ON), true);
    assert.equal(shouldAutoRetry(base, {}), false);
});

test('retries only worker-reported failures of a first build that is still building and has a prompt', () => {
    assert.equal(shouldAutoRetry(base, ON), true);
    assert.equal(shouldAutoRetry({ ...base, cls: 'NO_RESULT' }, ON), true);
    for (const cls of ['DISPATCH_ERROR', 'TIMEOUT_STUCK', 'RETRY_EXHAUSTED', 'UNKNOWN']) assert.equal(shouldAutoRetry({ ...base, cls }, ON), false, cls);
    assert.equal(shouldAutoRetry({ ...base, flag: undefined }, ON), false); // manual /retry and the automatic re-dispatch carry no flag
    assert.equal(shouldAutoRetry({ ...base, flag: '0' }, ON), false);
    assert.equal(shouldAutoRetry({ ...base, projectStatus: 'failed' }, ON), false);
    assert.equal(shouldAutoRetry({ ...base, projectStatus: 'ready' }, ON), false);
    assert.equal(shouldAutoRetry({ ...base, hasPrompt: false }, ON), false);
});

test('delay: default 60 s, 0 allowed, capped at 5 min, garbage falls back', () => {
    assert.equal(autoRetryDelayMs({}), 60000);
    assert.equal(autoRetryDelayMs({ BUILD_AUTO_RETRY_DELAY_MS: '0' }), 0);
    assert.equal(autoRetryDelayMs({ BUILD_AUTO_RETRY_DELAY_MS: '999999999' }), 300000);
    assert.equal(autoRetryDelayMs({ BUILD_AUTO_RETRY_DELAY_MS: 'abc' }), 60000);
    assert.equal(autoRetryDelayMs({ BUILD_AUTO_RETRY_DELAY_MS: '-5' }), 60000);
});

test('marker is a content-free class token', () => {
    assert.equal(autoRetryMarker('WORKER_ERROR'), 'AUTO_RETRIED:WORKER_ERROR');
});
