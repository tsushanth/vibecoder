/**
 * VibeCoder Worker — Multi-Phase Iterative Build
 *
 * Runs on a machine with Claude Code CLI installed (Pro subscription, OAuth auth).
 * Uses a 5-phase iterative approach:
 *   1. Generate — Claude creates the web application project
 *   2. Validate — Automated checks for structure, dependencies, responsiveness
 *   3. Fix — Claude fixes detected issues, TODOs, placeholders, filler code
 *   4. Polish — Claude reviews and improves design quality, completeness
 *   5. Verify — Final automated check that the app will work in WebView
 *
 * Status updates are streamed via SSE so the client can show progress.
 *
 * Start: node server.js
 */

import express from 'express';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import crypto from 'crypto';
import zlib from 'zlib';

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.WORKER_PORT || 3456;
const WORKER_SECRET = process.env.WORKER_SECRET || 'vibecoder-worker-secret-2024';
const PROJECTS_DIR = path.join(os.homedir(), '.vibecoder-worker', 'projects');
const GITHUB_PAT = process.env.GITHUB_PAT || '';
const GITHUB_ORG = process.env.GITHUB_ORG || 'Kreative-Koala-LLC';

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// ============================================
// Claude CLI Discovery
// ============================================

function findClaudeCLI() {
    try {
        const result = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (result.trim()) return result.trim();
    } catch {}

    const vscodeExtDir = path.join(os.homedir(), '.vscode', 'extensions');
    if (fs.existsSync(vscodeExtDir)) {
        const dirs = fs.readdirSync(vscodeExtDir)
            .filter(d => d.startsWith('anthropic.claude-code-'))
            .sort()
            .reverse();
        for (const dir of dirs) {
            const binaryPath = path.join(vscodeExtDir, dir, 'resources', 'native-binary', 'claude');
            if (fs.existsSync(binaryPath)) return binaryPath;
        }
    }

    const paths = [
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        '/root/.local/bin/claude',
        path.join(os.homedir(), '.local', 'bin', 'claude'),
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error('Claude CLI not found');
}

// ============================================
// Quota Detection & Tracking
// ============================================

const QUOTA_PATTERNS = [
    "You're out of extra usage",
    'out of extra usage',
    'usage limit',
    'rate limit exceeded',
    'quota exceeded',
    'resets 8am',
    'resets at',
];

// ============================================
// Account Pool — Multi-Account Claude Rotation
// ============================================
// Set CLAUDE_ACCOUNT_HOMES to a comma-separated list of home directories,
// each pre-authenticated with a different Claude Pro account.
// e.g. CLAUDE_ACCOUNT_HOMES=/home/claude1,/home/claude2
// Falls back to the current user's home if not set (single-account mode).

const ACCOUNT_HOMES = process.env.CLAUDE_ACCOUNT_HOMES
    ? process.env.CLAUDE_ACCOUNT_HOMES.split(',').map(s => s.trim()).filter(Boolean)
    : [os.homedir()];

const accountPool = ACCOUNT_HOMES.map(homeDir => ({
    homeDir,
    exhausted: false,
    resetTime: null,
    _timer: null,
}));

let currentAccountIdx = 0;

// ============================================
// OAuth Token Auto-Refresh
// ============================================
// If CLAUDE_REFRESH_TOKEN is set, refresh the access token on startup
// and every 7 hours so CLAUDE_CODE_OAUTH_TOKEN never expires in production.

const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

async function writeSecretVersion(secretName, value) {
    try {
        const metaRes = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
            headers: { 'Metadata-Flavor': 'Google' },
        });
        const { access_token } = await metaRes.json();
        const projectId = process.env.GCLOUD_PROJECT || 'summarizerproxy';
        const encoded = Buffer.from(value).toString('base64');
        const res = await fetch(`https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${secretName}:addVersion`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: { data: encoded } }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log(`[OAuth] Written new ${secretName} to Secret Manager`);
    } catch (err) {
        console.error(`[OAuth] Failed to write ${secretName} to Secret Manager:`, err.message);
    }
}

async function refreshOAuthToken() {
    const refreshToken = process.env.CLAUDE_REFRESH_TOKEN;
    if (!refreshToken) return;
    try {
        const res = await fetch(CLAUDE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: CLAUDE_OAUTH_CLIENT_ID,
            }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        process.env.CLAUDE_CODE_OAUTH_TOKEN = data.access_token;
        if (data.refresh_token) {
            process.env.CLAUDE_REFRESH_TOKEN = data.refresh_token;
            // Write new tokens back so future cold-start instances get fresh credentials
            await writeSecretVersion('CLAUDE_OAUTH_TOKEN', data.access_token);
            await writeSecretVersion('CLAUDE_REFRESH_TOKEN', data.refresh_token);
        }
        console.log('[OAuth] Token refreshed, expires in', data.expires_in, 'seconds');
    } catch (err) {
        console.error('[OAuth] Token refresh failed:', err.message);
    }
}

// Refresh on startup, then every 7 hours
refreshOAuthToken();
setInterval(refreshOAuthToken, 7 * 60 * 60 * 1000);

function getActiveAccount() {
    for (let i = 0; i < accountPool.length; i++) {
        const idx = (currentAccountIdx + i) % accountPool.length;
        if (!accountPool[idx].exhausted) {
            currentAccountIdx = idx;
            return accountPool[idx];
        }
    }
    return null; // all exhausted
}

function markAccountExhausted(homeDir, resetTime) {
    const account = accountPool.find(a => a.homeDir === homeDir);
    if (!account || account.exhausted) return;
    account.exhausted = true;
    account.resetTime = resetTime || null;
    if (account._timer) clearTimeout(account._timer);
    // Auto-clear after 1 hour in case we missed the actual reset
    account._timer = setTimeout(() => {
        account.exhausted = false;
        account.resetTime = null;
        account._timer = null;
        console.log(`[AccountPool] Account auto-reset: ${homeDir}`);
    }, 3600000);
    const available = accountPool.filter(a => !a.exhausted).length;
    console.log(`[AccountPool] Exhausted: ${homeDir} | ${available}/${accountPool.length} accounts remaining`);
    // Advance pointer to next available account
    for (let i = 1; i <= accountPool.length; i++) {
        const idx = (currentAccountIdx + i) % accountPool.length;
        if (!accountPool[idx].exhausted) {
            currentAccountIdx = idx;
            console.log(`[AccountPool] Rotated to: ${accountPool[idx].homeDir}`);
            break;
        }
    }
}

function clearAccountQuota(homeDir) {
    const account = accountPool.find(a => a.homeDir === homeDir);
    if (account && account.exhausted) {
        account.exhausted = false;
        account.resetTime = null;
        if (account._timer) { clearTimeout(account._timer); account._timer = null; }
        console.log(`[AccountPool] Quota cleared (successful run): ${homeDir}`);
    }
}

function allAccountsExhausted() {
    return accountPool.every(a => a.exhausted);
}

function containsQuotaError(text) {
    const lower = text.toLowerCase();
    return QUOTA_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

const AUTH_FAILURE_PATTERNS = [
    'not logged in',
    'please log in',
    'authentication required',
    'login required',
    'not authenticated',
    'invalid api key',
    'api key not found',
];

function containsAuthError(text) {
    const lower = text.toLowerCase();
    return AUTH_FAILURE_PATTERNS.some(p => lower.includes(p));
}

/**
 * Extract the reset time from Claude's quota error message.
 * Claude typically says: "Your usage limit resets at 8am PT" or "resets 8am Pacific Time"
 */
function extractResetTime(text) {
    // Try to find "resets at <time>" or "resets <time>"
    const patterns = [
        /resets?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:PT|PST|PDT|Pacific|ET|EST|EDT|Eastern|CT|CST|CDT|Central|UTC)?)/i,
        /try again (?:at|after)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
        /available (?:at|after)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].trim();
    }

    return null;
}

function getQuotaErrorMessage() {
    const resetTimes = accountPool.map(a => a.resetTime).filter(Boolean);
    if (resetTimes.length > 0) {
        return `AI usage limit reached. Service resets at ${resetTimes[0]}. Please try again after that.`;
    }
    return 'AI usage limit reached. The service typically resets at 8am Pacific Time. Please try again later.';
}

let activeGenerations = 0;
const MAX_CONCURRENT = 2;

// ============================================
// CLAUDE.md Guardrails
// ============================================

const CLAUDE_MD = `# Web Application Project

You are building a self-contained web application that runs in a mobile WebView and can be deployed as a static site.

## Project Structure
Create your project as a proper web project in this directory:
\`\`\`
index.html          <- Entry point (REQUIRED)
css/style.css       <- Styles (optional, can inline)
js/app.js           <- Application logic (optional, can inline)
assets/             <- Generated assets (SVG, data URIs)
\`\`\`

## Absolute Rules
- **No external dependencies**: No CDNs, no fetch calls to external APIs, no external fonts/images. Everything must be local or inline.
- **No node_modules**: Pure browser project. No npm, no bundlers.
- **Mobile-first**: Responsive design required. Touch-friendly. Viewport meta required.
- **Self-contained**: Must work offline when loaded from local files.

## Required in index.html
1. \`<meta name="viewport" content="width=device-width, initial-scale=1.0">\`
2. Responsive layout that works on all screen sizes
3. Complete, functional implementation

## Asset Creation
- SVG inline or as .svg files
- CSS art and gradients
- Canvas drawing for dynamic graphics
- Web Audio API for sound effects (no audio files)
- Data URIs for small embedded images

## Design Guidelines
- Modern, clean design with good typography
- Smooth animations and transitions
- Professional UI/UX
- Dark mode support where appropriate
- Accessible: proper contrast ratios, semantic HTML

## CRITICAL: No Placeholder Code
- Do NOT leave TODO comments, placeholder functions, or stub implementations
- Every function must be fully implemented
- Every visual element must be fully designed
- Every feature must actually work
`;

// ============================================
// Build Phase Definitions
// ============================================

const BUILD_PHASES = [
    {
        id: 'generate',
        label: 'Building your app',
        description: 'Creating project files from your description',
        maxTurns: 15,
    },
    {
        id: 'validate',
        label: 'Checking quality',
        description: 'Running automated quality checks',
        maxTurns: 0, // No Claude call, just validation
    },
    {
        id: 'fix',
        label: 'Fixing issues',
        description: 'Resolving any problems found',
        maxTurns: 10,
    },
    {
        id: 'polish',
        label: 'Polishing design',
        description: 'Improving UI and completeness',
        maxTurns: 8,
    },
    {
        id: 'verify',
        label: 'Final verification',
        description: 'Ensuring everything works perfectly',
        maxTurns: 0, // No Claude call, just final checks
    },
];

// Phase progress mapping for client-side progress bars
const PHASE_PROGRESS = {
    'generate':  { startPct: 0,  endPct: 50, typicalSeconds: 30 },
    'validate':  { startPct: 50, endPct: 60, typicalSeconds: 1 },
    'fix':       { startPct: 60, endPct: 75, typicalSeconds: 20 },
    'polish':    { startPct: 75, endPct: 90, typicalSeconds: 15 },
    'verify':    { startPct: 90, endPct: 95, typicalSeconds: 1 },
    'package':   { startPct: 95, endPct: 100, typicalSeconds: 1 },
};

const PHASE_ORDER = ['generate', 'validate', 'fix', 'polish', 'verify', 'package'];

// ============================================
// Project Folder Management
// ============================================

function setupProjectFolder(requestId) {
    const projectDir = path.join(PROJECTS_DIR, requestId);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), CLAUDE_MD);
    return projectDir;
}

function cleanupProjectFolder(projectDir) {
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}
}

/**
 * Create a zip file from a directory using Node.js built-in zlib (no system zip needed).
 * Builds a valid ZIP archive with local file headers, data, and central directory.
 */
function zipProjectFolder(projectDir) {
    const files = [];
    function walk(dir, prefix = '') {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'CLAUDE.md' || entry.name === '.claude') continue;
            const fullPath = path.join(dir, entry.name);
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(fullPath, rel);
            } else {
                files.push({ rel, fullPath });
            }
        }
    }
    walk(projectDir);

    const entries = [];
    const buffers = [];
    let offset = 0;

    for (const file of files) {
        const content = fs.readFileSync(file.fullPath);
        const compressed = zlib.deflateRawSync(content);
        const nameBuffer = Buffer.from(file.rel, 'utf-8');

        // CRC-32
        const crc = crc32(content);

        // Local file header (30 + nameLen + compressedLen)
        const localHeader = Buffer.alloc(30 + nameBuffer.length);
        localHeader.writeUInt32LE(0x04034b50, 0);   // signature
        localHeader.writeUInt16LE(20, 4);             // version needed
        localHeader.writeUInt16LE(0, 6);              // flags
        localHeader.writeUInt16LE(8, 8);              // compression: deflate
        localHeader.writeUInt16LE(0, 10);             // mod time
        localHeader.writeUInt16LE(0, 12);             // mod date
        localHeader.writeUInt32LE(crc, 14);           // crc32
        localHeader.writeUInt32LE(compressed.length, 18); // compressed size
        localHeader.writeUInt32LE(content.length, 22);    // uncompressed size
        localHeader.writeUInt16LE(nameBuffer.length, 26); // filename length
        localHeader.writeUInt16LE(0, 28);             // extra field length
        nameBuffer.copy(localHeader, 30);

        entries.push({ nameBuffer, crc, compressed, content, localHeaderOffset: offset });
        buffers.push(localHeader, compressed);
        offset += localHeader.length + compressed.length;
    }

    // Central directory
    const centralStart = offset;
    const centralBuffers = [];

    for (const entry of entries) {
        const cdHeader = Buffer.alloc(46 + entry.nameBuffer.length);
        cdHeader.writeUInt32LE(0x02014b50, 0);        // signature
        cdHeader.writeUInt16LE(20, 4);                  // version made by
        cdHeader.writeUInt16LE(20, 6);                  // version needed
        cdHeader.writeUInt16LE(0, 8);                   // flags
        cdHeader.writeUInt16LE(8, 10);                  // compression: deflate
        cdHeader.writeUInt16LE(0, 12);                  // mod time
        cdHeader.writeUInt16LE(0, 14);                  // mod date
        cdHeader.writeUInt32LE(entry.crc, 16);          // crc32
        cdHeader.writeUInt32LE(entry.compressed.length, 20); // compressed size
        cdHeader.writeUInt32LE(entry.content.length, 24);    // uncompressed size
        cdHeader.writeUInt16LE(entry.nameBuffer.length, 28); // filename length
        cdHeader.writeUInt16LE(0, 30);                  // extra field length
        cdHeader.writeUInt16LE(0, 32);                  // file comment length
        cdHeader.writeUInt16LE(0, 34);                  // disk number start
        cdHeader.writeUInt16LE(0, 36);                  // internal attrs
        cdHeader.writeUInt32LE(0, 38);                  // external attrs
        cdHeader.writeUInt32LE(entry.localHeaderOffset, 42); // relative offset
        entry.nameBuffer.copy(cdHeader, 46);

        centralBuffers.push(cdHeader);
        offset += cdHeader.length;
    }

    // End of central directory
    const centralSize = offset - centralStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);              // signature
    eocd.writeUInt16LE(0, 4);                        // disk number
    eocd.writeUInt16LE(0, 6);                        // disk with central dir
    eocd.writeUInt16LE(entries.length, 8);            // entries on this disk
    eocd.writeUInt16LE(entries.length, 10);           // total entries
    eocd.writeUInt32LE(centralSize, 12);              // central dir size
    eocd.writeUInt32LE(centralStart, 16);             // central dir offset
    eocd.writeUInt16LE(0, 20);                        // comment length

    const zipBuffer = Buffer.concat([...buffers, ...centralBuffers, eocd]);

    return Promise.resolve({
        base64: zipBuffer.toString('base64'),
        sizeBytes: zipBuffer.length
    });
}

/** CRC-32 calculation */
const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    return table;
})();

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Unzip a base64 ZIP bundle into a directory (reverse of zipProjectFolder).
 * Parses the ZIP central directory to extract all files.
 */
function unzipBundle(base64Bundle, targetDir) {
    const zipBuffer = Buffer.from(base64Bundle, 'base64');

    // Find end of central directory record (scan from end)
    let eocdOffset = -1;
    for (let i = zipBuffer.length - 22; i >= 0; i--) {
        if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset === -1) throw new Error('Invalid ZIP: no end of central directory');

    const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
    const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);

    let offset = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) break;

        const compressionMethod = zipBuffer.readUInt16LE(offset + 10);
        const compressedSize = zipBuffer.readUInt32LE(offset + 20);
        const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
        const nameLength = zipBuffer.readUInt16LE(offset + 28);
        const extraLength = zipBuffer.readUInt16LE(offset + 30);
        const commentLength = zipBuffer.readUInt16LE(offset + 32);
        const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
        const fileName = zipBuffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8');

        // Skip directories
        if (!fileName.endsWith('/') && uncompressedSize > 0) {
            // Read from local file header
            const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
            const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
            const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
            const compressedData = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);

            let fileContent;
            if (compressionMethod === 8) {
                fileContent = zlib.inflateRawSync(compressedData);
            } else {
                fileContent = compressedData;
            }

            // Zip-slip protection
            const outPath = path.join(targetDir, fileName);
            if (!outPath.startsWith(path.resolve(targetDir))) continue;

            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, fileContent);
        }

        offset += 46 + nameLength + extraLength + commentLength;
    }
}

/**
 * List files in project (excluding CLAUDE.md) for metadata
 */
function listProjectFiles(projectDir) {
    const files = [];
    function walk(dir, prefix = '') {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'CLAUDE.md' || entry.name === '.claude') continue;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(path.join(dir, entry.name), rel);
            } else {
                const stat = fs.statSync(path.join(dir, entry.name));
                files.push({ path: rel, size: stat.size });
            }
        }
    }
    walk(projectDir);
    return files;
}

// ============================================
// Deep Code Quality Checks
// ============================================

/**
 * Read all source code from the project
 */
function readAllSourceCode(projectDir) {
    const files = listProjectFiles(projectDir);
    const sources = {};
    for (const file of files) {
        if (file.path.endsWith('.html') || file.path.endsWith('.js') || file.path.endsWith('.css')) {
            sources[file.path] = fs.readFileSync(path.join(projectDir, file.path), 'utf-8');
        }
    }
    return sources;
}

/**
 * Check for structural issues (missing files, viewport, etc.)
 */
function checkStructure(projectDir, sources) {
    const issues = [];
    const indexPath = path.join(projectDir, 'index.html');

    if (!fs.existsSync(indexPath)) {
        issues.push({ severity: 'critical', issue: 'Missing index.html entry point' });
        return issues;
    }

    const html = sources['index.html'] || '';

    if (!html.includes('viewport')) {
        issues.push({ severity: 'critical', issue: 'Missing viewport meta tag — app will not scale on mobile' });
    }

    if (!html.includes('<!DOCTYPE') && !html.includes('<!doctype')) {
        issues.push({ severity: 'warning', issue: 'Missing DOCTYPE declaration' });
    }

    return issues;
}

/**
 * Check for external dependencies (CDN links, external URLs)
 */
function checkExternalDeps(sources) {
    const issues = [];
    for (const [filePath, content] of Object.entries(sources)) {
        // Check src/href pointing to external URLs
        const externalMatches = content.match(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi);
        if (externalMatches) {
            for (const match of externalMatches) {
                issues.push({
                    severity: 'critical',
                    issue: `External URL in ${filePath}: ${match.substring(0, 80)}. All resources must be local.`
                });
            }
        }
        // Check for fetch/XMLHttpRequest to external
        if (/fetch\s*\(\s*["']https?:\/\//i.test(content)) {
            issues.push({
                severity: 'critical',
                issue: `External fetch() call in ${filePath}. App must work offline.`
            });
        }
    }
    return issues;
}

/**
 * Check for responsive design (viewport meta tag)
 */
function checkResponsiveDesign(sources) {
    const issues = [];
    const html = sources['index.html'] || '';

    if (!html.includes('viewport')) {
        issues.push({
            severity: 'critical',
            issue: 'Missing viewport meta tag. App must include <meta name="viewport" ...> for mobile responsiveness.'
        });
    }

    return issues;
}

/**
 * Check for TODOs, placeholders, and incomplete code
 */
function checkCompleteness(sources) {
    const issues = [];
    const todoPatterns = [
        /\/\/\s*TODO/gi,
        /\/\/\s*FIXME/gi,
        /\/\/\s*HACK/gi,
        /\/\/\s*XXX/gi,
        /\/\*\s*TODO/gi,
        /placeholder/gi,
        /implement\s+(this|later|here)/gi,
        /stub/gi,
        /not\s+implemented/gi,
        /coming\s+soon/gi,
        /work\s+in\s+progress/gi,
    ];

    for (const [filePath, content] of Object.entries(sources)) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (const pattern of todoPatterns) {
                pattern.lastIndex = 0; // Reset regex
                if (pattern.test(line)) {
                    // Skip false positives in CLAUDE.md content or comments about placeholder prevention
                    if (line.includes('Do NOT leave TODO') || line.includes('no "placeholder"') ||
                        line.includes('No Placeholder')) continue;
                    // Skip CSS placeholder styling
                    if (filePath.endsWith('.css') && line.includes('::placeholder')) continue;
                    issues.push({
                        severity: 'warning',
                        issue: `Incomplete code in ${filePath}:${i + 1}: "${line.trim().substring(0, 80)}"`
                    });
                    break; // One issue per line
                }
            }
        }

        // Check for empty function bodies (common filler pattern)
        const emptyFns = content.match(/function\s+\w+\s*\([^)]*\)\s*\{\s*\}/g);
        if (emptyFns) {
            for (const fn of emptyFns) {
                issues.push({
                    severity: 'warning',
                    issue: `Empty function in ${filePath}: ${fn.substring(0, 60)}`
                });
            }
        }
    }

    return issues;
}

/**
 * Check that JS files referenced in HTML actually exist
 */
function checkFileReferences(projectDir, sources) {
    const issues = [];
    const html = sources['index.html'] || '';

    // Find all script src and link href
    const scriptRefs = html.match(/src\s*=\s*["']([^"']+)["']/gi) || [];
    const linkRefs = html.match(/href\s*=\s*["']([^"']+)["']/gi) || [];

    const allRefs = [...scriptRefs, ...linkRefs]
        .map(r => r.match(/["']([^"']+)["']/)?.[1])
        .filter(Boolean)
        .filter(r => !r.startsWith('http') && !r.startsWith('//') && !r.startsWith('#') && !r.startsWith('data:'));

    for (const ref of allRefs) {
        const refPath = path.join(projectDir, ref);
        if (!fs.existsSync(refPath)) {
            issues.push({
                severity: 'critical',
                issue: `Broken file reference in index.html: "${ref}" does not exist`
            });
        }
    }

    return issues;
}

/**
 * Run all validation checks and return categorized results
 */
function fullValidation(projectDir) {
    const sources = readAllSourceCode(projectDir);

    const allIssues = [
        ...checkStructure(projectDir, sources),
        ...checkExternalDeps(sources),
        ...checkResponsiveDesign(sources),
        ...checkCompleteness(sources),
        ...checkFileReferences(projectDir, sources),
    ];

    const critical = allIssues.filter(i => i.severity === 'critical');
    const warnings = allIssues.filter(i => i.severity === 'warning');

    return { critical, warnings, allIssues, passedChecks: allIssues.length === 0 };
}

// ============================================
// Auth & Health
// ============================================

function authMiddleware(req, res, next) {
    const secret = req.headers['x-worker-secret'];
    if (secret !== WORKER_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.get('/health', (req, res) => {
    let cliAvailable = false;
    let cliPath = '';
    try { cliPath = findClaudeCLI(); cliAvailable = true; } catch {}

    let gitAvail = false;
    try { execSync('git --version', { stdio: 'pipe' }); gitAvail = true; } catch {}

    res.json({
        healthy: true,
        cliAvailable,
        cliPath,
        activeGenerations,
        maxConcurrent: MAX_CONCURRENT,
        quotaExhausted: allAccountsExhausted(),
        accounts: accountPool.map(a => ({ homeDir: a.homeDir, exhausted: a.exhausted, resetTime: a.resetTime })),
        gitAvailable: gitAvail,
        gitConfigured: !!GITHUB_PAT,
        githubOrg: GITHUB_ORG,
        uptime: process.uptime()
    });
});

// ============================================
// SSE Generate Endpoint (streaming status)
// ============================================

app.post('/generate', authMiddleware, async (req, res) => {
    const { prompt, userId, stream, referenceImage } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'App description is required' });
    }

    if (activeGenerations >= MAX_CONCURRENT) {
        return res.status(429).json({ error: 'Worker busy. Try again in a moment.' });
    }

    // Fail fast if all accounts are exhausted
    if (allAccountsExhausted()) {
        return res.status(503).json({
            error: getQuotaErrorMessage(),
            quotaExhausted: true,
        });
    }

    activeGenerations++;
    const startTime = Date.now();
    const requestId = `app-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    let projectDir = null;
    let account = getActiveAccount();

    // If streaming requested, set up SSE
    const isSSE = stream === true;
    let heartbeatInterval = null;
    if (isSSE) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        // Send keepalive comments every 15s to prevent idle connection timeouts
        heartbeatInterval = setInterval(() => {
            try { res.write(':heartbeat\n\n'); } catch {}
        }, 15000);
        res.on('close', () => { if (heartbeatInterval) clearInterval(heartbeatInterval); });
    }

    function sendStatus(phase, message, detail) {
        const progress = PHASE_PROGRESS[phase] || { startPct: 0, endPct: 0, typicalSeconds: 0 };
        const currentIndex = PHASE_ORDER.indexOf(phase);
        let estimatedRemaining = 0;
        for (let i = currentIndex; i < PHASE_ORDER.length; i++) {
            const p = PHASE_PROGRESS[PHASE_ORDER[i]];
            if (p) estimatedRemaining += p.typicalSeconds;
        }

        console.log(`[${requestId}] [${phase}] ${message}${detail ? ': ' + detail : ''} (${progress.startPct}-${progress.endPct}%, ~${estimatedRemaining}s remaining)`);
        if (isSSE) {
            res.write(`data: ${JSON.stringify({
                type: 'status', phase, message, detail,
                progressPercent: progress.startPct,
                progressEndPct: progress.endPct,
                phaseDurationSeconds: progress.typicalSeconds,
                estimatedSecondsRemaining: estimatedRemaining
            })}\n\n`);
        }
    }

    function sendError(error) {
        if (isSSE) {
            res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
            res.end();
        } else {
            res.status(503).json({ error });
        }
    }

    function sendResult(data) {
        if (isSSE) {
            res.write(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`);
            res.end();
        } else {
            res.json(data);
        }
    }

    console.log(`[${requestId}] Starting multi-phase build for ${userId}: "${prompt}"`);

    try {
        const claudePath = findClaudeCLI();

        // ========================
        // Phase 1: GENERATE
        // ========================
        sendStatus('generate', 'Building your app', 'Creating project files from your description');

        projectDir = setupProjectFolder(requestId);

        // If user provided a reference image, save it to the project directory
        if (referenceImage && typeof referenceImage === 'string') {
            try {
                const imageBuffer = Buffer.from(referenceImage, 'base64');
                fs.writeFileSync(path.join(projectDir, 'reference.png'), imageBuffer);
                // Append reference image guidance to CLAUDE.md
                fs.appendFileSync(path.join(projectDir, 'CLAUDE.md'), `

## Reference Image
A reference image is provided at \`./reference.png\`. Read this image file first.
Use it as visual inspiration for the app's design, layout, color scheme, or features.
Do NOT embed the reference image in the app — recreate the visual elements using CSS, SVG, Canvas, or other inline techniques.
`);
                console.log(`[${requestId}] Reference image saved (${imageBuffer.length} bytes)`);
            } catch (imgErr) {
                console.error(`[${requestId}] Failed to save reference image:`, imgErr.message);
            }
        }

        const hasImage = referenceImage && fs.existsSync(path.join(projectDir, 'reference.png'));
        const generatePrompt = `Create a complete web application based on this description: "${prompt.trim()}"
${hasImage ? '\nThe user provided a reference image at ./reference.png — read it first and use it as visual context for the app design (layout, colors, style, features).\n' : ''}
Read CLAUDE.md carefully for ALL requirements and constraints.

IMPORTANT RULES:
- Create all files in THIS directory with index.html as the entry point
- Every function must be FULLY implemented — no stubs, no TODOs
- The application must be COMPLETE and fully functional
- All assets must be created inline (SVG, CSS art, canvas) — no external resources
- Make it professional with clean design and smooth interactions

Start building now. Create the files.`;

        // Use rotation wrapper so quota mid-generate auto-retries on next account
        const genResult = await runClaudeWithRotation(claudePath, generatePrompt, projectDir, requestId, 15);
        // Track which account actually ran (may have rotated)
        account = getActiveAccount() || account;

        if (!genResult.success) {
            activeGenerations--;
            if (genResult.quotaError) {
                const msg = getQuotaErrorMessage();
                console.log(`[${requestId}] All accounts exhausted: ${msg}`);
                return sendError(msg);
            }
            return sendError('Failed to generate app. Please try again.');
        }

        // Check index.html exists
        if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
            const htmlFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.html') && f !== 'CLAUDE.md');
            if (htmlFiles.length > 0) {
                fs.renameSync(path.join(projectDir, htmlFiles[0]), path.join(projectDir, 'index.html'));
            } else {
                activeGenerations--;
                return sendError('No app files were created. Please try again with a different description.');
            }
        }

        // ========================
        // Phase 2: VALIDATE
        // ========================
        sendStatus('validate', 'Checking quality', 'Running automated quality checks');

        const validation1 = fullValidation(projectDir);
        const totalIssues1 = validation1.allIssues.length;

        console.log(`[${requestId}] Validation: ${validation1.critical.length} critical, ${validation1.warnings.length} warnings`);

        // ========================
        // Phase 3: FIX (if issues found)
        // ========================
        if (totalIssues1 > 0) {
            const issueList = validation1.allIssues
                .map((i, idx) => `${idx + 1}. [${i.severity.toUpperCase()}] ${i.issue}`)
                .join('\n');

            sendStatus('fix', 'Fixing issues', `Found ${totalIssues1} issue${totalIssues1 > 1 ? 's' : ''} to resolve`);

            const fixPrompt = `I've run automated checks on the web application project and found these issues:

${issueList}

IMPORTANT:
- Fix ALL critical issues — they will break the app
- Fix warnings where possible — they affect app quality
- Do NOT add TODO/FIXME comments — implement actual fixes
- If functions are empty or stubbed, write the REAL implementation
- If placeholder text exists, replace with real content
- Make sure every file reference in index.html points to a real file
- Read CLAUDE.md if you need to review the requirements

Fix all these issues now by editing the files directly.`;

            const fixResult = await runClaudeCommand(claudePath, fixPrompt, projectDir, requestId, 10, account.homeDir);

            if (!fixResult.success && fixResult.quotaError) {
                markAccountExhausted(account.homeDir, fixResult.resetTime);
                console.log(`[${requestId}] Quota hit during fix phase, continuing with current state`);
            }
        } else {
            sendStatus('fix', 'No issues found', 'App passed all quality checks');
        }

        // ========================
        // Phase 4: POLISH
        // ========================
        sendStatus('polish', 'Polishing design', 'Improving UI and completeness');

        // Re-validate to see current state
        const validation2 = fullValidation(projectDir);
        const remainingCritical = validation2.critical.length;

        // Only do polish pass if no critical issues remain (don't waste turns polishing broken code)
        if (remainingCritical === 0) {
            const polishPrompt = `Review the web application and make final improvements:

1. COMPLETENESS: Walk through every feature. Fix logic gaps, undefined variables, broken flows.

2. DESIGN: Is it visually appealing? Improve typography, spacing, colors, transitions.

3. RESPONSIVENESS: Does it work on small phones and large tablets?

4. POLISH: Add micro-interactions, hover effects, loading states, empty states.

5. EDGE CASES: Handle edge cases gracefully.

Make targeted improvements — don't rewrite everything.`;

            const polishResult = await runClaudeCommand(claudePath, polishPrompt, projectDir, requestId, 8, account.homeDir);

            if (!polishResult.success && polishResult.quotaError) {
                markAccountExhausted(account.homeDir, polishResult.resetTime);
                console.log(`[${requestId}] Quota hit during polish — continuing`);
            }
        } else {
            // Still have critical issues — run another fix pass instead of polish
            sendStatus('fix', 'Additional fixes needed', `${remainingCritical} critical issue${remainingCritical > 1 ? 's' : ''} remaining`);

            const criticalList = validation2.critical
                .map((i, idx) => `${idx + 1}. ${i.issue}`)
                .join('\n');

            const fixPrompt2 = `These CRITICAL issues still remain and MUST be fixed for the app to work:

${criticalList}

Fix them now. The app will not load at all if these aren't resolved.`;

            await runClaudeCommand(claudePath, fixPrompt2, projectDir, requestId, 5, account.homeDir);
        }

        // ========================
        // Phase 5: VERIFY
        // ========================
        sendStatus('verify', 'Final verification', 'Ensuring everything works');

        const finalValidation = fullValidation(projectDir);
        const files = listProjectFiles(projectDir);

        // Log final state
        const criticalLeft = finalValidation.critical.length;
        const warningsLeft = finalValidation.warnings.length;
        console.log(`[${requestId}] Final: ${files.length} files, ${criticalLeft} critical, ${warningsLeft} warnings`);

        if (criticalLeft > 0) {
            console.log(`[${requestId}] WARNING: ${criticalLeft} critical issues remain:`);
            for (const issue of finalValidation.critical) {
                console.log(`  - ${issue.issue}`);
            }
        }

        // ========================
        // Package & Return
        // ========================
        sendStatus('package', 'Packaging app', 'Creating downloadable bundle');

        const zip = await zipProjectFolder(projectDir);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(`[${requestId}] App complete in ${elapsed}s (${files.length} files, ${(zip.sizeBytes / 1024).toFixed(1)}KB)`);

        sendResult({
            success: true,
            bundle: zip.base64,
            bundleSize: zip.sizeBytes,
            files,
            generationTime: elapsed,
            quality: {
                criticalIssues: criticalLeft,
                warnings: warningsLeft,
                phasesCompleted: criticalLeft === 0 ? 5 : 3,
            }
        });

    } catch (error) {
        console.error(`[${requestId}] Error:`, error.message);
        sendError('Internal worker error. Please try again.');
    } finally {
        activeGenerations--;
        if (projectDir) {
            setTimeout(() => cleanupProjectFolder(projectDir), 120000);
        }
    }
});

// ============================================
// Claude Code CLI Runner
// ============================================

function runClaudeCommand(claudePath, prompt, cwd, requestId, maxTurns = 10, homeDir = os.homedir()) {
    return new Promise((resolve) => {
        const args = [
            '-p', prompt,
            '--dangerously-skip-permissions',
            '--output-format', 'stream-json',
            '--max-turns', String(maxTurns),
            '--verbose'
        ];

        console.log(`[${requestId}] Claude CLI starting (maxTurns: ${maxTurns}, account: ${homeDir})...`);

        const proc = spawn(claudePath, args, {
            cwd,
            env: {
                ...process.env,
                PATH: `${process.env.PATH || ''}:/usr/bin:/usr/local/bin:/opt/homebrew/bin`,
                HOME: homeDir,
                IS_SANDBOX: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        const assistantBlocks = [];

        const timeout = setTimeout(() => {
            console.log(`[${requestId}] Timeout after 8 min`);
            proc.kill('SIGTERM');
            resolve({ success: false, output: assistantBlocks.join(''), error: 'Timeout', quotaError: false });
        }, 480000);

        proc.stdout?.on('data', (data) => {
            for (const line of data.toString().split('\n').filter(l => l.trim())) {
                try {
                    const event = JSON.parse(line);
                    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                        assistantBlocks.push(event.delta.text || '');
                    } else if (event.type === 'result') {
                        console.log(`[${requestId}] Claude finished`);
                    }
                } catch {}
            }
        });

        proc.stderr?.on('data', (data) => {
            const msg = data.toString();
            stderr += msg;
            // Log file operations for visibility
            if (msg.includes('Write(') || msg.includes('Edit(') || msg.includes('Read(')) {
                const clean = msg.trim().substring(0, 150);
                console.log(`[${requestId}]   ${clean}`);
            }
            if (containsQuotaError(msg)) {
                console.log(`[${requestId}] Quota error detected`);
            }
        });

        proc.on('close', (code) => {
            clearTimeout(timeout);
            const output = assistantBlocks.join('');
            const isQuotaError = containsQuotaError(stderr) || containsQuotaError(output);
            const isAuthError = !isQuotaError && (containsAuthError(stderr) || containsAuthError(output));
            const resetTime = isQuotaError ? (extractResetTime(stderr) || extractResetTime(output)) : null;

            if (code !== 0 || isQuotaError || isAuthError) {
                console.error(`[${requestId}] Claude exited code=${code} stderr=${stderr.substring(0, 500)}`);
            }

            if (code === 0 && !isQuotaError) {
                clearAccountQuota(homeDir);
                resolve({ success: true, output, quotaError: false });
            } else if (isQuotaError) {
                resolve({ success: false, output, error: 'Quota exhausted', quotaError: true, resetTime });
            } else if (isAuthError) {
                console.error(`[${requestId}] Auth failure on account ${homeDir} — re-authentication needed`);
                resolve({ success: false, output, error: `Auth failure on account ${homeDir}. Re-run 'claude login' for this account.`, quotaError: false, authError: true });
            } else {
                resolve({ success: false, output, error: `Exit code ${code}`, quotaError: false });
            }
        });

        proc.on('error', (error) => {
            clearTimeout(timeout);
            resolve({ success: false, output: '', error: error.message, quotaError: false });
        });
    });
}

// ============================================
// Account-rotating Claude runner (for critical phases)
// Tries the active account; on quota hit, rotates and retries once.
// ============================================

async function runClaudeWithRotation(claudePath, prompt, cwd, requestId, maxTurns) {
    let account = getActiveAccount();
    if (!account) {
        return { success: false, error: getQuotaErrorMessage(), quotaError: true };
    }

    const result = await runClaudeCommand(claudePath, prompt, cwd, requestId, maxTurns, account.homeDir);

    if (!result.quotaError) return result;

    // Quota hit — mark exhausted and try the next account
    markAccountExhausted(account.homeDir, result.resetTime);
    const next = getActiveAccount();
    if (!next) {
        return result; // all accounts exhausted
    }

    console.log(`[${requestId}] Retrying on rotated account: ${next.homeDir}`);
    return runClaudeCommand(claudePath, prompt, cwd, requestId, maxTurns, next.homeDir);
}

// ============================================
// App Customization (fork from parent bundle)
// ============================================

const CUSTOMIZE_CLAUDE_MD_APPEND = `
## Customization Rules
You are modifying a web application based on a user's customization request.
- Read all existing project files first
- Make ONLY the changes needed to fulfill the request
- Keep the app fully functional
- Keep mobile responsiveness intact
- Do NOT break existing features
- Do NOT rewrite the entire app — targeted modifications only
- Do NOT add TODO/FIXME comments
`;

app.post('/customize', authMiddleware, async (req, res) => {
    const { parentBundle, customizeDescription, appTitle, newTitle, stream } = req.body;

    if (!parentBundle || typeof parentBundle !== 'string') {
        return res.status(400).json({ error: 'parentBundle is required (base64 ZIP)' });
    }

    if (!customizeDescription || customizeDescription.trim().length === 0) {
        return res.status(400).json({ error: 'customizeDescription is required' });
    }

    if (activeGenerations >= MAX_CONCURRENT) {
        return res.status(429).json({ error: 'Worker busy. Try again in a moment.' });
    }

    if (allAccountsExhausted()) {
        return res.status(503).json({
            error: getQuotaErrorMessage(),
            quotaExhausted: true,
        });
    }

    activeGenerations++;
    const startTime = Date.now();
    const account = getActiveAccount();
    const requestId = `customize-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    let projectDir = null;

    const isSSE = stream === true;
    let heartbeatInterval = null;
    if (isSSE) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        heartbeatInterval = setInterval(() => {
            try { res.write(':heartbeat\n\n'); } catch {}
        }, 15000);
        res.on('close', () => { if (heartbeatInterval) clearInterval(heartbeatInterval); });
    }

    function sendStatus(phase, message, detail) {
        const progress = PHASE_PROGRESS[phase] || { startPct: 0, endPct: 0, typicalSeconds: 0 };
        const currentIndex = PHASE_ORDER.indexOf(phase);
        let estimatedRemaining = 0;
        for (let i = currentIndex; i < PHASE_ORDER.length; i++) {
            const p = PHASE_PROGRESS[PHASE_ORDER[i]];
            if (p) estimatedRemaining += p.typicalSeconds;
        }
        console.log(`[${requestId}] [${phase}] ${message}${detail ? ': ' + detail : ''}`);
        if (isSSE) {
            res.write(`data: ${JSON.stringify({
                type: 'status', phase, message, detail,
                progressPercent: progress.startPct,
                progressEndPct: progress.endPct,
                phaseDurationSeconds: progress.typicalSeconds,
                estimatedSecondsRemaining: estimatedRemaining
            })}\n\n`);
        }
    }

    function sendError(error) {
        if (isSSE) {
            res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
            res.end();
        } else {
            res.status(503).json({ error });
        }
    }

    function sendResult(data) {
        if (isSSE) {
            res.write(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`);
            res.end();
        } else {
            res.json(data);
        }
    }

    console.log(`[${requestId}] Customizing "${appTitle}" -> "${newTitle || appTitle}": "${customizeDescription.substring(0, 80)}"`);

    try {
        const claudePath = findClaudeCLI();

        // Phase 1: Setup — unpack parent bundle
        sendStatus('generate', 'Preparing customization', `Applying changes to ${appTitle}`);

        projectDir = setupProjectFolder(requestId);
        unzipBundle(parentBundle, projectDir);

        // Write CLAUDE.md with base + customization instructions
        fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), CLAUDE_MD + CUSTOMIZE_CLAUDE_MD_APPEND);

        const customizePrompt = `A user wants the following customization to this web application "${appTitle}":
"${customizeDescription.trim()}"

${newTitle && newTitle !== appTitle ? `The customized app should be titled "${newTitle}".` : ''}

Read all existing project files first to understand the application.
Then make ONLY the changes needed to fulfill this customization request.

IMPORTANT RULES:
- Keep the app fully functional
- Keep mobile responsiveness intact
- Do NOT break existing features
- Do NOT rewrite the entire app — targeted modifications only
- Do NOT add TODO/FIXME comments
- Read CLAUDE.md for all quality requirements

Modify the existing files now to apply the customization.`;

        const genResult = await runClaudeWithRotation(claudePath, customizePrompt, projectDir, requestId, 15);

        if (!genResult.success) {
            activeGenerations--;
            if (genResult.quotaError) {
                return sendError(getQuotaErrorMessage());
            }
            return sendError('Failed to customize app. Please try again.');
        }

        // Phase 2: Validate
        sendStatus('validate', 'Checking quality', 'Running automated quality checks');
        const validation1 = fullValidation(projectDir);
        console.log(`[${requestId}] Validation: ${validation1.critical.length} critical, ${validation1.warnings.length} warnings`);

        // Phase 3: Fix if needed
        if (validation1.allIssues.length > 0) {
            const issueList = validation1.allIssues
                .map((i, idx) => `${idx + 1}. [${i.severity.toUpperCase()}] ${i.issue}`)
                .join('\n');

            sendStatus('fix', 'Fixing issues', `Found ${validation1.allIssues.length} issue(s) to resolve`);

            const fixPrompt = `Automated checks found these issues in the customized app:

${issueList}

Fix ALL critical issues. Do NOT add TODO comments — implement actual fixes.`;

            await runClaudeCommand(claudePath, fixPrompt, projectDir, requestId, 10, account.homeDir);
        } else {
            sendStatus('fix', 'No issues found', 'App passed all quality checks');
        }

        // Phase 4: Quick polish
        sendStatus('polish', 'Final polish', 'Ensuring customization works well');

        const validation2 = fullValidation(projectDir);
        if (validation2.critical.length === 0) {
            const polishPrompt = `Quick review of the customized app:
1. Does the customization ("${customizeDescription.substring(0, 100)}") look correct?
2. Is the app still fully functional (not broken by the changes)?
3. Does it work well on mobile?

Make any small fixes needed. Don't rewrite — just polish.`;

            await runClaudeCommand(claudePath, polishPrompt, projectDir, requestId, 5, account.homeDir);
        }

        // Phase 5: Verify
        sendStatus('verify', 'Final verification', 'Ensuring everything works');
        const finalValidation = fullValidation(projectDir);
        const files = listProjectFiles(projectDir);

        console.log(`[${requestId}] Final: ${files.length} files, ${finalValidation.critical.length} critical, ${finalValidation.warnings.length} warnings`);

        // Package
        sendStatus('package', 'Packaging app', 'Creating downloadable bundle');

        const zip = await zipProjectFolder(projectDir);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(`[${requestId}] Customization complete in ${elapsed}s (${(zip.sizeBytes / 1024).toFixed(1)}KB)`);

        sendResult({
            success: true,
            bundle: zip.base64,
            bundleSize: zip.sizeBytes,
            files,
            generationTime: elapsed,
            quality: {
                criticalIssues: finalValidation.critical.length,
                warnings: finalValidation.warnings.length,
            }
        });

    } catch (error) {
        console.error(`[${requestId}] Error:`, error.message);
        sendError('Internal worker error during customization.');
    } finally {
        activeGenerations--;
        if (projectDir) {
            setTimeout(() => cleanupProjectFolder(projectDir), 120000);
        }
    }
});

// ============================================
// Git Integration for App Tweaks
// ============================================

/**
 * Check if git is available on this machine.
 */
function checkGitAvailable() {
    try {
        const version = execSync('git --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        console.log(`[git] ${version}`);
        return true;
    } catch {
        console.warn('[git] WARNING: git not found — tweak features will be unavailable');
        return false;
    }
}

function getRepoName(projectId) {
    return `app-${projectId}`;
}

function getCloneUrl(repoName) {
    return `https://x-access-token:${GITHUB_PAT}@github.com/${GITHUB_ORG}/${repoName}.git`;
}

/**
 * Create a private GitHub repo under the org.
 */
async function createGitHubRepo(repoName) {
    console.log(`[git] Creating repo: ${GITHUB_ORG}/${repoName}`);
    const response = await fetch(`https://api.github.com/orgs/${GITHUB_ORG}/repos`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GITHUB_PAT}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: repoName,
            private: true,
            auto_init: false,
            description: 'VibeCoder app bundle',
        }),
    });

    if (response.status === 422) {
        console.log(`[git] Repo ${repoName} already exists (422)`);
        return { success: true, alreadyExists: true };
    }

    if (!response.ok) {
        const body = await response.text();
        console.error(`[git] GitHub API error ${response.status}: ${body}`);
        throw new Error(`GitHub API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    console.log(`[git] Repo created: ${data.html_url}`);
    return { success: true, repoUrl: data.html_url };
}

/**
 * Check if a GitHub repo exists under the org.
 */
async function checkRepoExists(repoName) {
    console.log(`[git] Checking repo exists: ${GITHUB_ORG}/${repoName}`);
    const response = await fetch(`https://api.github.com/repos/${GITHUB_ORG}/${repoName}`, {
        headers: {
            'Authorization': `Bearer ${GITHUB_PAT}`,
            'Accept': 'application/vnd.github+json',
        },
    });
    const exists = response.ok;
    console.log(`[git] Repo ${repoName} exists: ${exists}`);
    return exists;
}

/**
 * Get commit history for a repo via GitHub API.
 */
async function getGitCommitHistory(repoName, limit = 20) {
    console.log(`[git] Fetching commit history: ${GITHUB_ORG}/${repoName} (limit=${limit})`);
    const response = await fetch(
        `https://api.github.com/repos/${GITHUB_ORG}/${repoName}/commits?per_page=${limit}`,
        {
            headers: {
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github+json',
            },
        }
    );

    if (!response.ok) {
        if (response.status === 409) {
            console.log(`[git] Empty repo (no commits)`);
            return [];
        }
        const body = await response.text();
        console.error(`[git] Commit history error ${response.status}: ${body}`);
        throw new Error(`GitHub API error ${response.status}`);
    }

    const commits = await response.json();
    console.log(`[git] Got ${commits.length} commits`);
    return commits.map(c => ({
        sha: c.sha,
        shortSha: c.sha.substring(0, 7),
        message: c.commit.message,
        date: c.commit.author.date,
        author: c.commit.author.name,
    }));
}

/**
 * Clone a repo into a target directory.
 */
function gitClone(repoName, targetDir) {
    const cloneUrl = getCloneUrl(repoName);
    console.log(`[git] Cloning ${GITHUB_ORG}/${repoName} -> ${targetDir}`);
    try {
        execSync(`git clone "${cloneUrl}" "${targetDir}"`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 60000,
        });
        execSync(`git -C "${targetDir}" config user.email "bot@vibecoder.com"`, { stdio: 'pipe' });
        execSync(`git -C "${targetDir}" config user.name "VibeCoder Bot"`, { stdio: 'pipe' });
        console.log(`[git] Clone successful`);
        return true;
    } catch (err) {
        console.error(`[git] Clone failed: ${err.message}`);
        throw err;
    }
}

/**
 * Commit all changes and push to remote.
 * Optionally push to a specific branch (creates it if needed).
 * Returns the commit SHA or null if no changes.
 */
function gitCommitAndPush(repoDir, message, branch = 'main') {
    console.log(`[git] Committing to ${branch}: "${message.substring(0, 80)}"`);
    try {
        // Switch to target branch (create if doesn't exist)
        if (branch !== 'main') {
            try {
                execSync(`git -C "${repoDir}" checkout ${branch}`, { stdio: 'pipe' });
                console.log(`[git] Switched to existing branch ${branch}`);
            } catch {
                execSync(`git -C "${repoDir}" checkout -b ${branch}`, { stdio: 'pipe' });
                console.log(`[git] Created new branch ${branch}`);
            }
        }

        execSync(`git -C "${repoDir}" add -A`, { stdio: 'pipe' });

        // Check if there are staged changes
        try {
            execSync(`git -C "${repoDir}" diff --cached --quiet`, { stdio: 'pipe' });
            console.log(`[git] No changes to commit`);
            return null;
        } catch {
            // diff --quiet exits 1 when there are changes — this is expected
        }

        // Exclude CLAUDE.md from commit
        try {
            execSync(`git -C "${repoDir}" reset HEAD CLAUDE.md`, { stdio: 'pipe' });
        } catch {
            // CLAUDE.md might not be tracked — that's fine
        }
        // Also exclude .claude directory
        try {
            execSync(`git -C "${repoDir}" reset HEAD .claude`, { stdio: 'pipe' });
        } catch {}

        const safeMessage = message.replace(/"/g, '\\"').replace(/\$/g, '\\$');
        execSync(`git -C "${repoDir}" commit -m "${safeMessage}"`, {
            stdio: 'pipe',
            encoding: 'utf-8',
        });

        const sha = execSync(`git -C "${repoDir}" rev-parse HEAD`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        console.log(`[git] Commit created: ${sha.substring(0, 7)}`);

        execSync(`git -C "${repoDir}" push origin ${branch}`, {
            stdio: 'pipe',
            timeout: 60000,
        });
        console.log(`[git] Push to ${branch} successful`);
        return sha;
    } catch (err) {
        console.error(`[git] Commit/push to ${branch} failed: ${err.message}`);
        throw err;
    }
}

/**
 * Download a specific file/tree at a given commit SHA from GitHub.
 * Returns base64-encoded ZIP of the repo at that commit.
 */
async function downloadRepoAtCommit(repoName, commitSha) {
    console.log(`[git] Downloading ${repoName} at commit ${commitSha.substring(0, 7)}`);
    const response = await fetch(
        `https://api.github.com/repos/${GITHUB_ORG}/${repoName}/zipball/${commitSha}`,
        {
            headers: {
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github+json',
            },
            redirect: 'follow',
        }
    );

    if (!response.ok) {
        throw new Error(`GitHub download error ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`[git] Downloaded ${(buffer.length / 1024).toFixed(1)}KB`);
    return buffer;
}

/**
 * Initialize a project's git repo from an existing base64 bundle.
 * Creates the repo on GitHub, extracts the bundle, commits, and pushes.
 */
async function initProjectRepo(projectId, base64Bundle) {
    const repoName = getRepoName(projectId);
    console.log(`[git:init] Initializing repo for project ${projectId}`);

    if (!GITHUB_PAT) {
        throw new Error('GITHUB_PAT not configured');
    }

    // Create the GitHub repo
    await createGitHubRepo(repoName);

    // Set up a temp directory
    const tempDir = path.join(PROJECTS_DIR, `init-${projectId}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        // Init local git repo
        console.log(`[git:init] Setting up local repo at ${tempDir}`);
        execSync(`git init "${tempDir}"`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" config user.email "bot@vibecoder.com"`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" config user.name "VibeCoder Bot"`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" branch -M main`, { stdio: 'pipe' });

        // Add .gitignore
        fs.writeFileSync(path.join(tempDir, '.gitignore'), 'CLAUDE.md\n.claude/\n');

        // Extract bundle into the temp dir
        console.log(`[git:init] Extracting bundle (${(Buffer.from(base64Bundle, 'base64').length / 1024).toFixed(1)}KB)`);
        unzipBundle(base64Bundle, tempDir);

        // Remove CLAUDE.md if it was in the bundle
        const claudeMdPath = path.join(tempDir, 'CLAUDE.md');
        if (fs.existsSync(claudeMdPath)) {
            fs.unlinkSync(claudeMdPath);
        }

        // Commit and push
        execSync(`git -C "${tempDir}" add -A`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" commit -m "Initial app creation"`, { stdio: 'pipe' });

        const cloneUrl = getCloneUrl(repoName);
        execSync(`git -C "${tempDir}" remote add origin "${cloneUrl}"`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" push -u origin main`, { stdio: 'pipe', timeout: 60000 });

        const sha = execSync(`git -C "${tempDir}" rev-parse HEAD`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        console.log(`[git:init] Repo initialized: ${GITHUB_ORG}/${repoName} (commit: ${sha.substring(0, 7)})`);
        return { success: true, repoName, commitSha: sha };
    } finally {
        setTimeout(() => {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        }, 5000);
    }
}

// ============================================
// POST /init-repo — Initialize git repo for an existing project
// ============================================

app.post('/init-repo', authMiddleware, async (req, res) => {
    const { projectId, bundle } = req.body;

    if (!projectId || !bundle) {
        return res.status(400).json({ error: 'projectId and bundle are required' });
    }

    if (!GITHUB_PAT) {
        return res.status(503).json({ error: 'Git integration not configured (missing GITHUB_PAT)' });
    }

    const requestId = `init-${projectId.substring(0, 8)}`;
    console.log(`[${requestId}] Initializing repo for project ${projectId}`);

    try {
        const result = await initProjectRepo(projectId, bundle);
        console.log(`[${requestId}] Repo init complete: ${result.repoName}`);
        res.json({
            success: true,
            repoName: result.repoName,
            commitSha: result.commitSha,
        });
    } catch (error) {
        console.error(`[${requestId}] Init repo error:`, error.message);
        res.status(500).json({ error: `Failed to initialize repo: ${error.message}` });
    }
});

// ============================================
// POST /tweak — Apply an iterative refinement to a project
// ============================================

const TWEAK_CLAUDE_MD_APPEND = `
## Tweak Task
You are modifying an EXISTING web application based on the creator's request.
- Read all existing project files FIRST before making any changes
- Only change what is necessary to fulfill the tweak request
- Keep the app fully functional after your changes
- Keep mobile responsiveness intact
- Keep the existing visual style unless the tweak specifically asks to change it
- Do NOT rewrite the entire app — make targeted modifications
- Do NOT add TODO comments or placeholder code
`;

app.post('/tweak', authMiddleware, async (req, res) => {
    const { projectId, repoName, tweakDescription, stream } = req.body;

    if (!tweakDescription || typeof tweakDescription !== 'string' || tweakDescription.trim().length === 0) {
        return res.status(400).json({ error: 'tweakDescription is required' });
    }

    if (!repoName) {
        return res.status(400).json({ error: 'repoName is required (initialize repo first)' });
    }

    if (!GITHUB_PAT) {
        return res.status(503).json({ error: 'Git integration not configured (missing GITHUB_PAT)' });
    }

    if (activeGenerations >= MAX_CONCURRENT) {
        return res.status(429).json({ error: 'Worker busy. Try again in a moment.' });
    }

    if (allAccountsExhausted()) {
        return res.status(503).json({
            error: getQuotaErrorMessage(),
            quotaExhausted: true,
        });
    }

    activeGenerations++;
    const startTime = Date.now();
    const account = getActiveAccount();
    const idPrefix = projectId ? projectId.substring(0, 8) : 'unknown';
    const requestId = `tweak-${idPrefix}-${Date.now()}`;
    let projectDir = null;

    const isSSE = stream === true;
    let heartbeatInterval = null;
    if (isSSE) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        // Send keepalive comments every 15s to prevent idle connection timeouts
        heartbeatInterval = setInterval(() => {
            try { res.write(':heartbeat\n\n'); } catch {}
        }, 15000);
        res.on('close', () => { if (heartbeatInterval) clearInterval(heartbeatInterval); });
    }

    function sendStatus(phase, message, detail) {
        const progress = PHASE_PROGRESS[phase] || { startPct: 0, endPct: 0, typicalSeconds: 0 };
        const currentIndex = PHASE_ORDER.indexOf(phase);
        let estimatedRemaining = 0;
        for (let i = currentIndex; i < PHASE_ORDER.length; i++) {
            const p = PHASE_PROGRESS[PHASE_ORDER[i]];
            if (p) estimatedRemaining += p.typicalSeconds;
        }
        console.log(`[${requestId}] [${phase}] ${message}${detail ? ': ' + detail : ''}`);
        if (isSSE) {
            res.write(`data: ${JSON.stringify({
                type: 'status', phase, message, detail,
                progressPercent: progress.startPct,
                progressEndPct: progress.endPct,
                phaseDurationSeconds: progress.typicalSeconds,
                estimatedSecondsRemaining: estimatedRemaining
            })}\n\n`);
        }
    }

    function sendError(error) {
        console.error(`[${requestId}] Error: ${error}`);
        if (isSSE) {
            res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
            res.end();
        } else {
            res.status(503).json({ error });
        }
    }

    function sendResult(data) {
        if (isSSE) {
            res.write(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`);
            res.end();
        } else {
            res.json(data);
        }
    }

    console.log(`[${requestId}] Starting tweak for project ${projectId}: "${tweakDescription.substring(0, 100)}"`);

    try {
        const claudePath = findClaudeCLI();

        // Phase 1: Clone repo
        sendStatus('generate', 'Preparing project files', 'Cloning project repository');

        projectDir = path.join(PROJECTS_DIR, requestId);
        fs.mkdirSync(projectDir, { recursive: true });

        try {
            gitClone(repoName, projectDir + '/repo');
            // Move files from repo subdirectory to project root for Claude
            const repoDir = path.join(projectDir, 'repo');
            const files = fs.readdirSync(repoDir);
            for (const file of files) {
                if (file === '.git') continue;
                const src = path.join(repoDir, file);
                const dst = path.join(projectDir, file);
                fs.renameSync(src, dst);
            }
            // Keep .git in place for later commit
            fs.renameSync(path.join(repoDir, '.git'), path.join(projectDir, '.git'));
            fs.rmSync(repoDir, { recursive: true, force: true });
        } catch (cloneErr) {
            activeGenerations--;
            return sendError(`Failed to clone project repo: ${cloneErr.message}`);
        }

        // Write CLAUDE.md with tweak instructions
        fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), CLAUDE_MD + TWEAK_CLAUDE_MD_APPEND);

        // Phase 2: Apply tweak via Claude
        sendStatus('generate', 'Applying your changes', `"${tweakDescription.substring(0, 60)}"`);

        const tweakPrompt = `The creator wants the following change to their web application:

"${tweakDescription.trim()}"

Read all the existing project files in this directory first to understand the current application.
Then make ONLY the changes needed to fulfill this request.

RULES:
- Keep the app fully functional — test your changes mentally
- Keep mobile responsiveness intact
- Do NOT break any existing features
- Do NOT rewrite the entire app — make targeted modifications
- Do NOT add TODO, FIXME, or placeholder comments
- Read CLAUDE.md for all quality requirements

Apply the changes now.`;

        const tweakResult = await runClaudeWithRotation(claudePath, tweakPrompt, projectDir, requestId, 12);

        if (!tweakResult.success) {
            activeGenerations--;
            if (tweakResult.quotaError) {
                return sendError(getQuotaErrorMessage());
            }
            return sendError('Failed to apply tweak. Please try again.');
        }

        // Phase 3: Validate
        sendStatus('validate', 'Checking quality', 'Running automated checks');

        const validation = fullValidation(projectDir);
        console.log(`[${requestId}] Validation: ${validation.critical.length} critical, ${validation.warnings.length} warnings`);

        // Phase 4: Fix if needed
        if (validation.critical.length > 0) {
            const issueList = validation.critical
                .map((i, idx) => `${idx + 1}. ${i.issue}`)
                .join('\n');

            sendStatus('fix', 'Fixing issues', `${validation.critical.length} critical issue(s) found`);

            const fixPrompt = `The tweak introduced these critical issues that MUST be fixed:

${issueList}

Fix them now. Do NOT add TODO comments — implement actual fixes.`;

            await runClaudeCommand(claudePath, fixPrompt, projectDir, requestId, 8, account.homeDir);
        } else {
            sendStatus('fix', 'No issues found', 'App passed quality checks');
        }

        // Phase 5: Verify
        sendStatus('verify', 'Final verification', 'Ensuring everything works');
        const finalValidation = fullValidation(projectDir);
        const files = listProjectFiles(projectDir);
        console.log(`[${requestId}] Final: ${files.length} files, ${finalValidation.critical.length} critical, ${finalValidation.warnings.length} warnings`);

        // Phase 6: Commit and push
        sendStatus('package', 'Saving changes', 'Committing to version history');

        let commitSha = null;
        try {
            commitSha = gitCommitAndPush(projectDir, `Tweak: ${tweakDescription.substring(0, 200)}`);
            if (!commitSha) {
                console.log(`[${requestId}] No changes detected after tweak — Claude may not have modified files`);
            }
        } catch (gitErr) {
            console.error(`[${requestId}] Git commit/push failed: ${gitErr.message}`);
            // Don't fail the whole request — still return the bundle
        }

        // Phase 7: Zip and return
        const zip = await zipProjectFolder(projectDir);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(`[${requestId}] Tweak complete in ${elapsed}s (commit: ${commitSha ? commitSha.substring(0, 7) : 'none'}, ${(zip.sizeBytes / 1024).toFixed(1)}KB)`);

        sendResult({
            success: true,
            bundle: zip.base64,
            bundleSize: zip.sizeBytes,
            files,
            commitSha,
            generationTime: elapsed,
            quality: {
                criticalIssues: finalValidation.critical.length,
                warnings: finalValidation.warnings.length,
            }
        });

    } catch (error) {
        console.error(`[${requestId}] Tweak error:`, error.message);
        sendError('Internal worker error during tweak.');
    } finally {
        activeGenerations--;
        if (projectDir) {
            setTimeout(() => cleanupProjectFolder(projectDir), 120000);
        }
    }
});

// ============================================
// GET /versions/:repoName — Get commit history for a project
// ============================================

app.get('/versions/:repoName', authMiddleware, async (req, res) => {
    const { repoName } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    console.log(`[versions] Fetching history for ${repoName}`);

    if (!GITHUB_PAT) {
        return res.status(503).json({ error: 'Git integration not configured' });
    }

    try {
        const commits = await getGitCommitHistory(repoName, limit);
        res.json({ success: true, versions: commits });
    } catch (error) {
        console.error(`[versions] Error:`, error.message);
        res.status(500).json({ error: 'Failed to fetch version history' });
    }
});

// ============================================
// Start
// ============================================

const gitAvailable = checkGitAvailable();

app.listen(PORT, () => {
    let cliPath = 'NOT FOUND';
    try { cliPath = findClaudeCLI(); } catch {}
    console.log(`VibeCoder Worker running on http://localhost:${PORT}`);
    console.log(`Claude CLI: ${cliPath}`);
    console.log(`Projects: ${PROJECTS_DIR}`);
    console.log(`Max concurrent: ${MAX_CONCURRENT}`);
    console.log(`GitHub org: ${GITHUB_ORG}`);
    console.log(`GitHub PAT: ${GITHUB_PAT ? '***configured***' : 'NOT SET'}`);
    console.log(`Git available: ${gitAvailable}`);
    console.log(`Build phases: ${BUILD_PHASES.map(p => p.id).join(' -> ')}`);
});
