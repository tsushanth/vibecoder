import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const copied = new Set([...dockerfile.matchAll(/^COPY\s+(\S+)\s+\.\/\S+/gm)].map((m) => m[1]));

function sources(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === 'test' || e.name === 'node_modules') return [];
        const p = path.join(dir, e.name);
        return e.isDirectory() ? sources(p) : e.name.endsWith('.js') ? [p] : [];
    });
}

test('every platform directory the running proxy imports from is copied into the image', () => {
    const needed = new Set(['proxy-app']);
    for (const f of sources(path.join(ROOT, 'proxy-app'))) {
        for (const m of fs.readFileSync(f, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
            const target = path.relative(ROOT, path.resolve(path.dirname(f), m[1]));
            if (!target.startsWith('..')) needed.add(target.split(path.sep)[0]);
        }
    }
    // follow one more level: modules imported by those directories
    for (const dir of [...needed]) for (const f of sources(path.join(ROOT, dir))) {
        for (const m of fs.readFileSync(f, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
            const target = path.relative(ROOT, path.resolve(path.dirname(f), m[1]));
            if (!target.startsWith('..')) needed.add(target.split(path.sep)[0]);
        }
    }
    for (const d of needed) { if (d.endsWith('.js')) continue; assert.ok(copied.has(d), `Dockerfile does not COPY ${d}`); }
    assert.ok(needed.has('auth') && needed.has('store') && needed.has('vibe-proxy'), [...needed].join(','));
});
