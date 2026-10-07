// File-block parsing and safe project IO for direct generation.
import fs from 'node:fs';
import path from 'node:path';

const SKIP_NAMES = new Set(['CLAUDE.md', 'vibedata.js', 'vibe.js', 'screenshot.png', '.git', '.claude', 'node_modules']);
const TEXT_EXT = /\.(html|css|js|mjs|json|svg|txt|md|webmanifest)$/i;

/** Parse `<file path="...">...</file>` blocks. Tolerates markdown fences and prose around the blocks. */
export function parseFiles(text) {
    const files = {};
    const rejected = [];
    const re = /<file\s+path="([^"]+)"\s*>\r?\n?([\s\S]*?)<\/file>/g;
    let m;
    while ((m = re.exec(text || ''))) {
        const raw = m[1].trim();
        const rel = raw.replace(/^\.?\//, '');
        if (!rel || rel.split('/').includes('..') || path.isAbsolute(rel) || rel.includes('\0')) {
            rejected.push(raw);
            continue;
        }
        if (SKIP_NAMES.has(path.basename(rel))) continue;
        // the newline before </file> is part of the block delimiter, not of the file
        files[rel] = m[2].replace(/\r?\n$/, '').replace(/^```[a-z]*\r?\n/, '').replace(/\r?\n```\s*$/, '');
    }
    // Models sometimes finish a complete page with a stray '>' or a markdown fence instead of </file>. A final, unclosed
    // block is accepted only for an .html file that already ends in </html>, so a reply cut off mid-file is still rejected.
    const text0 = text || '';
    const open = text0.lastIndexOf('<file');
    if (open !== -1 && text0.indexOf('</file>', open) === -1) {
        const m2 = /^<file\s+path="([^"]+)"\s*>\r?\n?/.exec(text0.slice(open));
        if (m2) {
            const rel = m2[1].trim().replace(/^\.?\//, '');
            const body = text0.slice(open + m2[0].length);
            const end = body.toLowerCase().lastIndexOf('</html>');
            const tail = end === -1 ? null : body.slice(end + 7);
            if (rel && !rel.split('/').includes('..') && !path.isAbsolute(rel) && !rel.includes('\0') && /\.html?$/i.test(rel) && !SKIP_NAMES.has(path.basename(rel))
                && tail !== null && /^[\s>`]*$/.test(tail) && !(rel in files)) {
                files[rel] = body.slice(0, end + 7).replace(/^```[a-z]*\r?\n/, '');
            }
        }
    }
    return { files, rejected };
}

/** Write files under dir; refuses any path that would escape it. */
export function writeFiles(dir, files) {
    const root = path.resolve(dir);
    for (const [rel, content] of Object.entries(files)) {
        const target = path.resolve(root, rel);
        if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`path escapes project: ${rel}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
}

/**
 * Read an existing project's text files for use as edit context.
 * Never truncates: when the total exceeds maxBytes, tooLarge is true and the caller must fail clearly.
 */
export function readProject(dir, { maxBytes = 120000 } = {}) {
    const files = {};
    let total = 0;
    let tooLarge = false;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (SKIP_NAMES.has(e.name) || e.name.startsWith('raw')) continue;
            const f = path.join(d, e.name);
            if (e.isDirectory()) walk(f);
            else if (TEXT_EXT.test(e.name)) {
                const c = fs.readFileSync(f, 'utf8');
                total += Buffer.byteLength(c);
                if (total > maxBytes) tooLarge = true;
                else files[path.relative(dir, f)] = c;
            }
        }
    };
    if (fs.existsSync(dir)) walk(dir);
    return { files, tooLarge, bytes: total };
}
