import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikePastedCode } from '../../lib/promptGuard.js';

test('ordinary requests that contain a code-looking substring are allowed', () => {
    for (const p of [
        'A CSV import system for my shop inventory',
        'Build a tour guide app to import OSHA checklists',
        'An app that shows ecosystem(s) of ponds',
        'I want a retrieval(search) tool for my notes',
        'Track my importer system',
    ]) assert.equal(looksLikePastedCode(p), false, p);
});

test('pasted code is still refused', () => {
    for (const p of [
        'import os\nimport sys\nprint(os.listdir("."))',
        'import subprocess; subprocess.run(["ls"])',
        'const x = require("fs"); eval(code)',
        'result = os.system("ls")',
        'child_process.exec("ls")',
        '#!/bin/bash\nrm -rf /',
        'def __init__(self):',
        'if __name__ == "__main__":',
        'document.cookie = "a=b"',
        'window.location.href="http://x"',
        'IMPORT OS',
        'regex.exec(text)',
    ]) assert.equal(looksLikePastedCode(p), true, p);
});

test('null and undefined are not code', () => {
    assert.equal(looksLikePastedCode(null), false);
    assert.equal(looksLikePastedCode(undefined), false);
});
