// GitHub export / import (Gap #7).
//
//   POST /api/github/export  - push a project's files to a repo the USER owns,
//                              using a per-request fine-grained PAT.
//   POST /api/github/import  - read-only import of a PUBLIC repo's static files
//                              into a base64-ZIP bundle (same shape /api/projects/save takes).
//
// Security invariants:
//  - The user's token is only ever placed in the Authorization header of a request to
//    api.github.com. It is never logged, stored, echoed, or included in error text.
//  - Only https://api.github.com and https://raw.githubusercontent.com are ever contacted;
//    owner/repo/ref/path are validated by strict charset so they cannot alter host or path.
//  - Every outbound fetch has a timeout and redirect: 'error'.
import express from 'express';
import zlib from 'zlib';
import rateLimit from 'express-rate-limit';
import { supabase } from '../config/database.js';
import { WORKER_URL, WORKER_SECRET } from '../config/constants.js';

const router = express.Router();

const GH_API = 'https://api.github.com';
const GH_RAW = 'https://raw.githubusercontent.com';
const TIMEOUT_MS = 15000;

export const LIMITS = {
    maxFiles: 200,
    maxFileBytes: 1024 * 1024,         // 1 MB per file
    maxTotalBytes: 8 * 1024 * 1024,    // 8 MB total
    maxTreeEntries: 5000,
    maxRawFetches: 200,
};

// Static web files only (no binaries other than common images/fonts, no scripts that run server-side).
const ALLOWED_EXT = new Set([
    'html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md', 'xml', 'webmanifest',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'ttf',
]);
const BLOCKED_SEGMENTS = new Set(['.git', '.github', 'node_modules', '.env']);

// ---------------------------------------------------------------------------
// Validation helpers (exported for tests)
// ---------------------------------------------------------------------------

// GitHub usernames: alphanumeric + single hyphens, 1-39 chars.
export function isValidOwner(s) {
    return typeof s === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(s) && !s.includes('--') && !s.endsWith('-');
}
// Repo names: [A-Za-z0-9._-], 1-100, not . or ..
export function isValidRepo(s) {
    return typeof s === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(s) && s !== '.' && s !== '..' && !s.endsWith('.git');
}
export function isValidRef(s) {
    return typeof s === 'string' && /^[A-Za-z0-9._\/-]{1,100}$/.test(s) && !s.includes('..') && !s.startsWith('/') && !s.endsWith('/');
}
// Accepts https://github.com/owner/repo[.git][/tree/ref[/...]] only. Returns {owner, repo, ref|null} or null.
export function parseRepoUrl(input) {
    if (typeof input !== 'string' || input.length > 300) return null;
    let u;
    try { u = new URL(input.trim()); } catch { return null; }
    if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.port) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, '');
    if (!isValidOwner(owner) || !isValidRepo(repo)) return null;
    let ref = null;
    if (parts[2] === 'tree' && parts[3]) {
        ref = parts[3]; // single-segment ref only; slashed branch names must be passed via `ref`
        if (!isValidRef(ref)) return null;
    }
    return { owner, repo, ref };
}
// A PAT must look like a token: no whitespace/control chars, sane length.
export function isPlausibleToken(t) {
    return typeof t === 'string' && t.length >= 20 && t.length <= 255 && /^[A-Za-z0-9_\-]+$/.test(t);
}
// Repo-relative path safety. Returns normalized path or null.
export function safePath(p) {
    if (typeof p !== 'string' || !p || p.length > 250 || p.includes('\\') || p.includes('\0')) return null;
    if (p.startsWith('/')) return null;
    const segs = p.split('/');
    for (const s of segs) {
        if (!s || s === '.' || s === '..' || BLOCKED_SEGMENTS.has(s.toLowerCase())) return null;
        if (!/^[A-Za-z0-9._@+ -]+$/.test(s)) return null;
    }
    return segs.join('/');
}
export function isAllowedFile(p) {
    const base = p.split('/').pop();
    if (base.startsWith('.env')) return false;
    const i = base.lastIndexOf('.');
    return i > 0 && ALLOWED_EXT.has(base.slice(i + 1).toLowerCase());
}

// ---------------------------------------------------------------------------
// ZIP read/write (bundle format = base64 ZIP, same as worker zipProjectFolder/unzipBundle)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export function buildZip(files /* [{path, data:Buffer}] */) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const f of files) {
        const name = Buffer.from(f.path, 'utf8');
        const comp = zlib.deflateRawSync(f.data);
        const crc = crc32(f.data);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
        lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
        ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
        ch.writeUInt32LE(offset, 42);
        locals.push(lh, name, comp); centrals.push(ch, name);
        offset += 30 + name.length + comp.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
}

// Reads a base64 ZIP into [{path, data}] with hard caps (zip-bomb safe: inflate has maxOutputLength).
export function readZip(base64) {
    const zip = Buffer.from(base64, 'base64');
    let eocd = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('invalid zip');
    const total = zip.readUInt16LE(eocd + 10);
    if (total > LIMITS.maxTreeEntries) throw new Error('too many entries');
    let off = zip.readUInt32LE(eocd + 16), sum = 0;
    const out = [];
    for (let n = 0; n < total; n++) {
        if (zip.readUInt32LE(off) !== 0x02014b50) break;
        const method = zip.readUInt16LE(off + 10), csize = zip.readUInt32LE(off + 20), usize = zip.readUInt32LE(off + 24);
        const nl = zip.readUInt16LE(off + 28), el = zip.readUInt16LE(off + 30), cl = zip.readUInt16LE(off + 32), lho = zip.readUInt32LE(off + 42);
        const name = zip.subarray(off + 46, off + 46 + nl).toString('utf8');
        off += 46 + nl + el + cl;
        if (name.endsWith('/')) continue;
        if (usize > LIMITS.maxFileBytes) throw new Error(`file too large: ${name}`);
        const ds = lho + 30 + zip.readUInt16LE(lho + 26) + zip.readUInt16LE(lho + 28);
        const raw = zip.subarray(ds, ds + csize);
        const data = method === 0 ? Buffer.from(raw)
            : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: LIMITS.maxFileBytes })
            : (() => { throw new Error('unsupported compression'); })();
        sum += data.length;
        if (sum > LIMITS.maxTotalBytes) throw new Error('bundle too large');
        out.push({ path: name, data });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Outbound GitHub fetch (allowlisted hosts only)
// ---------------------------------------------------------------------------

async function ghFetch(url, { token, method = 'GET', body } = {}) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || (u.origin !== GH_API && u.origin !== GH_RAW)) throw new Error('blocked host');
    if (token && u.origin !== GH_API) throw new Error('token only allowed for api.github.com');
    const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'VibeBuild-GitHub-Sync', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
}
async function readCapped(res, maxBytes) {
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('file too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('file too large');
    return buf;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const importLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many imports. Try again later.' } });
const exportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many exports. Try again later.' } });

// ---------------------------------------------------------------------------
// POST /api/github/import  { url, ref? }
// Returns { success, owner, repo, ref, fileCount, totalBytes, bundle, skipped, title, description }
// `bundle` (+ `title`) can be passed straight to POST /api/projects/save (with creatorId).
// ---------------------------------------------------------------------------
router.post('/import', importLimiter, async (req, res) => {
    try {
        const parsed = parseRepoUrl(req.body?.url);
        if (!parsed) return res.status(400).json({ error: 'url must be https://github.com/<owner>/<repo>' });
        const { owner, repo } = parsed;
        let ref = req.body?.ref ?? parsed.ref;
        if (ref != null && !isValidRef(ref)) return res.status(400).json({ error: 'invalid ref' });

        const metaRes = await ghFetch(`${GH_API}/repos/${owner}/${repo}`);
        if (metaRes.status === 404) return res.status(404).json({ error: 'Repository not found or not public' });
        if (metaRes.status === 403 || metaRes.status === 429) return res.status(429).json({ error: 'GitHub rate limit reached. Try again later.' });
        if (!metaRes.ok) return res.status(502).json({ error: 'GitHub request failed' });
        const meta = await metaRes.json();
        if (meta.private) return res.status(403).json({ error: 'Only public repositories can be imported' });
        if (typeof meta.size === 'number' && meta.size > 50 * 1024) { // KB; refuse very large repos up front
            return res.status(413).json({ error: 'Repository too large to import' });
        }
        ref = ref || meta.default_branch;
        if (!isValidRef(ref)) return res.status(502).json({ error: 'unexpected default branch' });

        const treeRes = await ghFetch(`${GH_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
        if (treeRes.status === 404) return res.status(404).json({ error: 'Branch/ref not found' });
        if (!treeRes.ok) return res.status(502).json({ error: 'GitHub request failed' });
        const tree = await treeRes.json();
        if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > LIMITS.maxTreeEntries) {
            return res.status(413).json({ error: 'Repository tree too large to import' });
        }

        const skipped = [];
        const picked = [];
        let declared = 0;
        for (const e of tree.tree) {
            if (e.type !== 'blob') continue;
            const p = safePath(e.path);
            if (!p || !isAllowedFile(p)) { skipped.push({ path: String(e.path).slice(0, 120), reason: 'type_or_path' }); continue; }
            if (typeof e.size === 'number' && e.size > LIMITS.maxFileBytes) { skipped.push({ path: p, reason: 'file_too_large' }); continue; }
            picked.push({ path: p, size: e.size || 0 });
        }
        if (picked.length === 0) return res.status(422).json({ error: 'No importable static files found' });
        if (picked.length > LIMITS.maxFiles) return res.status(413).json({ error: `Too many files (max ${LIMITS.maxFiles})` });
        for (const f of picked) declared += f.size;
        if (declared > LIMITS.maxTotalBytes) return res.status(413).json({ error: 'Repository files exceed size limit' });
        if (!picked.some(f => f.path === 'index.html')) {
            return res.status(422).json({ error: 'Repository root must contain index.html (static web projects only)' });
        }

        const files = [];
        let total = 0;
        for (const f of picked) {
            const rawUrl = `${GH_RAW}/${owner}/${repo}/${ref.split('/').map(encodeURIComponent).join('/')}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
            const r = await ghFetch(rawUrl);
            if (!r.ok) { skipped.push({ path: f.path, reason: `fetch_${r.status}` }); continue; }
            const data = await readCapped(r, LIMITS.maxFileBytes);
            total += data.length;
            if (total > LIMITS.maxTotalBytes) return res.status(413).json({ error: 'Repository files exceed size limit' });
            files.push({ path: f.path, data });
        }
        if (!files.some(f => f.path === 'index.html')) return res.status(422).json({ error: 'index.html could not be fetched' });

        const bundle = buildZip(files).toString('base64');
        res.json({
            success: true, owner, repo, ref,
            title: String(meta.name || repo).slice(0, 180),
            description: typeof meta.description === 'string' ? meta.description.slice(0, 500) : '',
            fileCount: files.length, totalBytes: total, skipped: skipped.slice(0, 50), bundle,
        });
    } catch (err) {
        console.error('[github/import] Error:', err.name === 'TimeoutError' ? 'timeout' : 'failed');
        res.status(err.name === 'TimeoutError' ? 504 : 500).json({ error: 'Import failed' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/github/export  { projectId, userId, token, owner, repo, branch?, message? }
// The repo must already exist and be owned/writable by the token holder (we never create repos,
// which keeps the required PAT scope to "Contents: read/write" on a single repo).
// ---------------------------------------------------------------------------
router.post('/export', exportLimiter, async (req, res) => {
    // Pull the token out immediately and remove it from req.body so nothing downstream can log it.
    const token = req.body?.token;
    if (req.body) delete req.body.token;
    try {
        const { projectId, userId, owner, repo } = req.body || {};
        const branch = req.body?.branch;
        const message = typeof req.body?.message === 'string' && req.body.message.trim() ? req.body.message.trim().slice(0, 200) : 'Export from VibeBuild';
        if (!projectId || typeof projectId !== 'string' || !userId) return res.status(400).json({ error: 'projectId and userId are required' });
        if (!isPlausibleToken(token)) return res.status(400).json({ error: 'A valid GitHub token is required' });
        if (!isValidOwner(owner) || !isValidRepo(repo)) return res.status(400).json({ error: 'invalid owner or repo' });
        if (branch != null && !isValidRef(branch)) return res.status(400).json({ error: 'invalid branch' });

        const { data: project, error } = await supabase.from('projects').select('id, creator_id, github_repo, bundle').eq('id', projectId).single();
        if (error || !project) return res.status(404).json({ error: 'Project not found' });
        if (project.creator_id !== userId) return res.status(403).json({ error: 'Not authorized' });

        let bundle = null;
        if (project.github_repo) {
            try {
                const w = await fetch(`${WORKER_URL}/bundle/${encodeURIComponent(project.github_repo)}`, { headers: { 'x-worker-secret': WORKER_SECRET }, signal: AbortSignal.timeout(60000) });
                if (w.ok) bundle = (await w.json()).bundle;
            } catch { /* fall through to DB bundle */ }
        }
        bundle = bundle || project.bundle;
        if (!bundle) return res.status(400).json({ error: 'No bundle available for this project' });

        const files = readZip(bundle).map(f => ({ path: safePath(f.path), data: f.data })).filter(f => f.path);
        if (files.length === 0 || files.length > LIMITS.maxFiles) return res.status(422).json({ error: 'Project has no exportable files' });

        const base = `${GH_API}/repos/${owner}/${repo}`;
        const repoRes = await ghFetch(base, { token });
        if (repoRes.status === 401) return res.status(401).json({ error: 'GitHub rejected the token' });
        if (repoRes.status === 404 || repoRes.status === 403) return res.status(403).json({ error: 'Repo not found or token lacks access (needs Contents: read & write on this repo)' });
        if (!repoRes.ok) return res.status(502).json({ error: 'GitHub request failed' });
        const repoMeta = await repoRes.json();
        if (repoMeta.permissions && repoMeta.permissions.push === false) return res.status(403).json({ error: 'Token has no write access to this repo' });
        const target = branch || repoMeta.default_branch;

        // Create blobs, then a tree, commit, and move the ref (fast-forward only; no force).
        const refRes = await ghFetch(`${base}/git/ref/heads/${target.split('/').map(encodeURIComponent).join('/')}`, { token });
        let parentSha = null;
        if (refRes.ok) parentSha = (await refRes.json()).object.sha;
        else if (refRes.status !== 404 && refRes.status !== 409) return res.status(502).json({ error: 'GitHub request failed' });
        if (!parentSha && branch) return res.status(404).json({ error: 'Branch does not exist' });
        // 404/409 with no branch specified = empty repo; the contents API can seed it.
        if (!parentSha) {
            return res.status(409).json({ error: 'Repository is empty. Initialize it (e.g. add a README) and retry.' });
        }
        const parentCommit = await (await ghFetch(`${base}/git/commits/${parentSha}`, { token })).json();

        const treeItems = [];
        for (const f of files) {
            const b = await ghFetch(`${base}/git/blobs`, { token, method: 'POST', body: { content: f.data.toString('base64'), encoding: 'base64' } });
            if (!b.ok) return res.status(502).json({ error: 'GitHub rejected a file upload' });
            treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: (await b.json()).sha });
        }
        const t = await ghFetch(`${base}/git/trees`, { token, method: 'POST', body: { base_tree: parentCommit.tree.sha, tree: treeItems } });
        if (!t.ok) return res.status(502).json({ error: 'GitHub rejected the tree' });
        const c = await ghFetch(`${base}/git/commits`, { token, method: 'POST', body: { message, tree: (await t.json()).sha, parents: [parentSha] } });
        if (!c.ok) return res.status(502).json({ error: 'GitHub rejected the commit' });
        const commit = await c.json();
        const u = await ghFetch(`${base}/git/refs/heads/${target.split('/').map(encodeURIComponent).join('/')}`, { token, method: 'PATCH', body: { sha: commit.sha, force: false } });
        if (!u.ok) return res.status(409).json({ error: 'Could not update branch (it may have changed). Retry.' });

        console.log(`[github/export] project=${projectId} -> ${owner}/${repo}@${target} files=${files.length}`);
        res.json({ success: true, repoUrl: `https://github.com/${owner}/${repo}`, branch: target, commitSha: commit.sha, fileCount: files.length });
    } catch (err) {
        // Never include err.message: fetch errors can embed request details.
        console.error('[github/export] Error:', err.name === 'TimeoutError' ? 'timeout' : 'failed');
        res.status(err.name === 'TimeoutError' ? 504 : 500).json({ error: 'Export failed' });
    }
});

export default router;
