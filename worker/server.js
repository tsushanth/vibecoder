import 'dotenv/config';
/**
 * VibeCoder Worker — Single-Pass Build
 *
 * Claude gets the prompt and builds the entire app in one shot.
 * No multi-phase pipeline — just create, build, zip, return.
 */

import express from 'express';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import crypto from 'crypto';
import zlib from 'zlib';
import { checkBrokerReady } from './brokerReady.js';
import { OpenRouterClient } from './lib/llm.js';
import { generateApp } from './lib/generate.js';
import { readProject, writeFiles } from './lib/files.js';
import { makeOutcomeLogger } from './lib/outcome.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.WORKER_PORT || 3456;
const WORKER_SECRET = process.env.WORKER_SECRET || 'vibecoder-worker-secret-2024';
const PROJECTS_DIR = path.join(os.homedir(), '.vibecoder-worker', 'projects');
const GITHUB_PAT = process.env.GITHUB_PAT || '';
const GITHUB_ORG = process.env.GITHUB_ORG || 'Kreative-Koala-LLC';

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// ============================================
// Direct generation (OpenRouter), behind a flag.
// DIRECT_PERCENT=0 (default) keeps every build on the Claude CLI exactly as before.
// ============================================
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const DIRECT_PERCENT = process.env.OPENROUTER_API_KEY ? Math.max(0, Math.min(100, parseInt(process.env.DIRECT_PERCENT || '0', 10) || 0)) : 0;
const DIRECT_MODELS = (process.env.DIRECT_MODELS || 'openai/gpt-5.6-luna,moonshotai/kimi-k2.7-code,deepseek/deepseek-v4-pro').split(',').map((m) => m.trim()).filter(Boolean);
const directLlm = process.env.OPENROUTER_API_KEY
    ? new OpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY, baseUrl: OPENROUTER_BASE_URL, dailyBudgetUsd: parseFloat(process.env.DIRECT_DAILY_BUDGET_USD || '5') })
    : null;
const logOutcome = makeOutcomeLogger({ file: process.env.OUTCOME_LOG || path.join(path.dirname(new URL(import.meta.url).pathname), 'outcomes.jsonl') });

function useDirect() {
    return !!directLlm && DIRECT_PERCENT > 0 && Math.random() * 100 < DIRECT_PERCENT;
}

async function runDirect({ kind, prompt, projectDir }) {
    let existing = null;
    if (kind !== 'generate') {
        const p = readProject(projectDir);
        if (p.tooLarge) return { success: false, cause: 'no_files', error: 'project too large for a direct edit' };
        existing = p.files;
    }
    const r = await generateApp({ prompt, kind, existing, llm: directLlm, models: DIRECT_MODELS, rules: CLAUDE_MD });
    if (!r.ok) return { success: false, cause: r.cause, attempts: r.attempts, costUsd: r.costUsd };
    writeFiles(projectDir, r.files);
    return { success: true, model: r.model, attempts: r.attempts, costUsd: r.costUsd, fixes: r.fixes };
}

// One outcome line per build, logged exactly once on every exit path (including the silent error paths).
function makeOutcome(requestId, kind, direct) {
    const t0 = Date.now();
    const ctx = { run: null, delivered: false, done: false };
    ctx.finish = () => {
        if (ctx.done) return;
        ctx.done = true;
        const r = ctx.run;
        let result;
        if (ctx.delivered) result = 'ok';
        else if (direct) result = ['no_files', 'check_failed', 'provider_error', 'declined_text', 'budget'].includes(r?.cause) ? r.cause : 'provider_error';
        else if (r?.quotaError) result = 'cli_failed';
        else if (r?.error === 'Timeout') result = 'timeout';
        else if (r && !r.success) result = 'cli_no_app';
        else result = 'provider_error';
        logOutcome({ requestId, kind, generator: direct ? 'direct' : 'claude', model: r?.model, result, attempts: r?.attempts, costUsd: r?.costUsd, fixes: r?.fixes, latencyMs: Date.now() - t0 });
    };
    return ctx;
}

// ============================================
// Claude CLI Discovery
// ============================================

function findClaudeCLI() {
    try {
        const result = execSync('which claude-multi', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (result.trim()) return result.trim();
    } catch {}
    const paths = ['/usr/local/bin/claude-multi', '/usr/bin/claude-multi'];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error('Claude CLI not found');
}

// ============================================
// Quota Detection
// ============================================

const QUOTA_PATTERNS = [
    "You're out of extra usage", "You've hit your limit", 'hit your limit',
    'out of extra usage', 'usage limit', 'rate limit exceeded', 'quota exceeded',
    'resets 8am', 'resets 7am', 'resets at', 'resets 5am', 'resets 6am',
];

let quotaExhausted = false;
let quotaResetTime = null;

function containsQuotaError(text) {
    const lower = text.toLowerCase();
    return QUOTA_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

function extractResetTime(text) {
    const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:PT|PST|PDT|Pacific|UTC)?)/i);
    return m ? m[1].trim() : null;
}

function getQuotaErrorMessage() {
    return quotaResetTime
        ? `AI usage limit reached. Service resets at ${quotaResetTime}. Please try again after that.`
        : 'AI usage limit reached. The service typically resets at 8am Pacific Time. Please try again later.';
}

let activeGenerations = 0;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '2');

// ============================================
// CLAUDE.md
// ============================================

const CLAUDE_MD = `# Web Application Project

You are building a self-contained web application that runs in a mobile WebView.

## Project Structure
index.html is the entry point (REQUIRED). CSS and JS can be inline or in separate files.

## Rules
- No external dependencies: no CDNs, no external APIs, no external fonts/images
- No node_modules: pure browser project
- Mobile-first: responsive design, touch-friendly, viewport meta required
- Self-contained: must work offline (except the leaderboard fetch below)

## Must include in index.html
- <meta name="viewport" content="width=device-width, initial-scale=1.0">
- Responsive layout that works on phones and tablets

## Fully Functional — Zero Shortcuts
- Every button must have a working click handler
- Every form must validate and process input
- Every game must have working win/lose/score logic
- Every counter/timer must actually count
- Use localStorage to persist data where appropriate

Do NOT leave TODO comments, empty functions, or placeholder text.

## Win Condition (REQUIRED for games)
- Every game MUST have a clear, reachable end state: level complete, puzzle solved, time up, or lives exhausted
- NO infinite games — the game must end within a reasonable number of actions or a fixed time limit
- Show a distinct "Game Over", "You Win", or "Level Complete" screen when the game ends
- The player must always be able to reach the end state through normal play

## Leaderboard Integration (REQUIRED for games)
When the game ends (win OR lose), submit the score and show the leaderboard.
Read userId and userName from the URL query params:

\`\`\`javascript
const params = new URLSearchParams(location.search);
const userId = params.get('userId') || 'anonymous';
const userName = params.get('userName') || 'Player';
const gameId = 'GAME_ID_PLACEHOLDER'; // do not change this literal

// Call this when game ends:
async function submitScoreAndShowLeaderboard(finalScore, secondsPlayed) {
  let leaderboard = [], userRank = null;
  try {
    const res = await fetch('https://puzzleverseai.com/api/leaderboard/custom/' + gameId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, userName, score: finalScore, timePlayed: secondsPlayed })
    });
    const data = await res.json();
    leaderboard = data.leaderboard || [];
    userRank = data.userRank;
  } catch(e) { /* offline — skip leaderboard */ }

  // Show leaderboard overlay (styled to match your game's theme)
  // Display rank 1-10 with: rank, userName, score, timePlayed
  // Highlight the current user's row
  // Show userRank even if user is outside top 10
  // Include a "Play Again" button that resets the game
}
\`\`\`

If the game has no score (pure puzzle/completion), pass score=0 and use timePlayed as the ranking metric.
`;

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

// ============================================
// ZIP / UNZIP
// ============================================

const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c;
    }
    return table;
})();

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipProjectFolder(projectDir) {
    const files = [];
    function walk(dir, prefix = '') {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'CLAUDE.md' || entry.name === '.claude' || entry.name === '.git') continue;
            const fullPath = path.join(dir, entry.name);
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(fullPath, rel);
            else files.push({ rel, fullPath });
        }
    }
    walk(projectDir);

    const entries = [], buffers = [];
    let offset = 0;

    for (const file of files) {
        const content = fs.readFileSync(file.fullPath);
        const compressed = zlib.deflateRawSync(content);
        const nameBuffer = Buffer.from(file.rel, 'utf-8');
        const crc = crc32(content);

        const localHeader = Buffer.alloc(30 + nameBuffer.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4); localHeader.writeUInt16LE(0, 6); localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt16LE(0, 10); localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compressed.length, 18); localHeader.writeUInt32LE(content.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26); localHeader.writeUInt16LE(0, 28);
        nameBuffer.copy(localHeader, 30);

        entries.push({ nameBuffer, crc, compressed, content, localHeaderOffset: offset });
        buffers.push(localHeader, compressed);
        offset += localHeader.length + compressed.length;
    }

    const centralStart = offset;
    const centralBuffers = [];
    for (const entry of entries) {
        const cdHeader = Buffer.alloc(46 + entry.nameBuffer.length);
        cdHeader.writeUInt32LE(0x02014b50, 0);
        cdHeader.writeUInt16LE(20, 4); cdHeader.writeUInt16LE(20, 6); cdHeader.writeUInt16LE(0, 8); cdHeader.writeUInt16LE(8, 10);
        cdHeader.writeUInt16LE(0, 12); cdHeader.writeUInt16LE(0, 14);
        cdHeader.writeUInt32LE(entry.crc, 16);
        cdHeader.writeUInt32LE(entry.compressed.length, 20); cdHeader.writeUInt32LE(entry.content.length, 24);
        cdHeader.writeUInt16LE(entry.nameBuffer.length, 28); cdHeader.writeUInt16LE(0, 30); cdHeader.writeUInt16LE(0, 32);
        cdHeader.writeUInt16LE(0, 34); cdHeader.writeUInt16LE(0, 36); cdHeader.writeUInt32LE(0, 38);
        cdHeader.writeUInt32LE(entry.localHeaderOffset, 42);
        entry.nameBuffer.copy(cdHeader, 46);
        centralBuffers.push(cdHeader);
        offset += cdHeader.length;
    }

    const centralSize = offset - centralStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(centralStart, 16); eocd.writeUInt16LE(0, 20);

    const zipBuffer = Buffer.concat([...buffers, ...centralBuffers, eocd]);
    return Promise.resolve({ base64: zipBuffer.toString('base64'), sizeBytes: zipBuffer.length });
}

function unzipBundle(base64Bundle, targetDir) {
    const zipBuffer = Buffer.from(base64Bundle, 'base64');
    let eocdOffset = -1;
    for (let i = zipBuffer.length - 22; i >= 0; i--) {
        if (zipBuffer.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
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

        if (!fileName.endsWith('/') && uncompressedSize > 0) {
            const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
            const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
            const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
            const compressedData = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);
            const fileContent = compressionMethod === 8 ? zlib.inflateRawSync(compressedData) : compressedData;
            const outPath = path.join(targetDir, fileName);
            if (!outPath.startsWith(path.resolve(targetDir))) continue;
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, fileContent);
        }
        offset += 46 + nameLength + extraLength + commentLength;
    }
}

function listProjectFiles(projectDir) {
    const files = [];
    function walk(dir, prefix = '') {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'CLAUDE.md' || entry.name === '.claude' || entry.name === '.git') continue;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
            else files.push({ path: rel, size: fs.statSync(path.join(dir, entry.name)).size });
        }
    }
    walk(projectDir);
    return files;
}

// ============================================
// Claude Runner
// ============================================

function runClaudeCommand(claudePath, prompt, cwd, requestId, maxTurns = 20) {
    return new Promise((resolve) => {
        const args = [
            '-p', prompt,
            '--dangerously-skip-permissions',
            '--output-format', 'stream-json',
            '--max-turns', String(maxTurns),
            '--verbose',
            '--model', 'claude-sonnet-4-5'
        ];

        console.log(`[${requestId}] Claude CLI starting (maxTurns: ${maxTurns})...`);

        const proc = spawn(claudePath, args, {
            cwd,
            env: (() => { const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...rest } = process.env; return { ...rest, PATH: `${process.env.PATH || ''}:/usr/bin:/usr/local/bin`, HOME: os.homedir() }; })(),
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
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            clearTimeout(timeout);
            const output = assistantBlocks.join('');
            const isQuotaError = containsQuotaError(stderr) || containsQuotaError(output);
            const resetTime = isQuotaError ? (extractResetTime(stderr) || extractResetTime(output) || null) : null;

            if (isQuotaError) {
                quotaExhausted = true;
                if (resetTime) quotaResetTime = resetTime;
                setTimeout(() => { quotaExhausted = false; quotaResetTime = null; }, 3600000);
                resolve({ success: false, output, error: 'Quota exhausted', quotaError: true, resetTime });
            } else if (code === 0) {
                if (quotaExhausted) { quotaExhausted = false; quotaResetTime = null; }
                resolve({ success: true, output, quotaError: false });
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
// Auth & Health
// ============================================

function authMiddleware(req, res, next) {
    if (req.headers['x-worker-secret'] !== WORKER_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// Readiness of the build path: can claude-multi get a token from the broker. Authenticated (reveals broker state).
app.get('/ready', authMiddleware, async (req, res) => {
    const out = await checkBrokerReady();
    res.status(out.ready ? 200 : 503).json(out);
});

app.get('/health', (req, res) => {
    let cliAvailable = false, cliPath = '';
    try { cliPath = findClaudeCLI(); cliAvailable = true; } catch {}
    res.json({ healthy: true, cliAvailable, cliPath, activeGenerations, maxConcurrent: MAX_CONCURRENT, quotaExhausted, quotaResetTime, uptime: process.uptime(), direct: { enabled: !!directLlm, percent: DIRECT_PERCENT, models: DIRECT_MODELS, breakersOpen: DIRECT_MODELS.filter((m) => directLlm?.isOpen(m)) } });
});

// ============================================
// POST /generate — Build an app
// ============================================

app.post('/generate', authMiddleware, async (req, res) => {
    const { prompt, userId, stream, referenceImage, callbackUrl, callbackSecret } = req.body;
    console.log(`[ENTRY] /generate: userId=${userId}, hasCallback=${!!callbackUrl}, promptLen=${prompt?.length}`);

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'App description is required' });
    }

    if (activeGenerations >= MAX_CONCURRENT) {
        return res.status(429).json({ error: 'Worker busy. Try again in a moment.' });
    }

    const direct = useDirect();
    if (!direct && quotaExhausted) {
        return res.status(503).json({ error: getQuotaErrorMessage(), quotaExhausted: true, resetTime: quotaResetTime });
    }

    activeGenerations++;
    const startTime = Date.now();
    const requestId = `app-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const outcome = makeOutcome(requestId, 'generate', direct);
    let projectDir = null;

    // Fire-and-forget mode — respond immediately, POST result to callbackUrl when done
    if (callbackUrl && stream !== true) {
        res.status(202).json({ success: true, requestId, message: 'Build started' });
    }

    // SSE mode — keep connection open
    const isSSE = stream === true;
    let heartbeatInterval = null;
    if (isSSE) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        heartbeatInterval = setInterval(() => { try { res.write(':heartbeat\n\n'); } catch {} }, 15000);
        res.on('close', () => { if (heartbeatInterval) clearInterval(heartbeatInterval); });
    }

    function sendStatus(message, detail, progressPercent = 10) {
        console.log(`[${requestId}] ${message}${detail ? ': ' + detail : ''}`);
        if (isSSE) {
            res.write(`data: ${JSON.stringify({ type: 'status', phase: 'generate', message, detail, progressPercent, progressEndPct: 95, estimatedSecondsRemaining: 120 })}\n\n`);
        }
    }

    function sendError(error) {
        if (isSSE) { res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`); try { res.end(); } catch {} }
        else if (!callbackUrl) { res.status(503).json({ error }); }
        if (callbackUrl) fetch(callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'failed', error, userId, secret: callbackSecret }), signal: AbortSignal.timeout(10000) }).catch(() => {});
    }

    function sendResult(data) {
        if (isSSE) { res.write(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`); try { res.end(); } catch {} }
        else if (!callbackUrl) { res.json(data); }
        if (callbackUrl) fetch(callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bundle: data.bundle, status: 'ready', userId, secret: callbackSecret }), signal: AbortSignal.timeout(30000) }).then(() => console.log(`[${requestId}] Callback sent`)).catch(err => console.error(`[${requestId}] Callback failed: ${err.message}`));
    }

    console.log(`[${requestId}] Building for ${userId}: "${prompt}"`);

    try {
        const claudePath = direct ? null : findClaudeCLI();
        projectDir = setupProjectFolder(requestId);

        // Save reference image if provided
        if (referenceImage && typeof referenceImage === 'string') {
            try {
                fs.writeFileSync(path.join(projectDir, 'reference.png'), Buffer.from(referenceImage, 'base64'));
                fs.appendFileSync(path.join(projectDir, 'CLAUDE.md'), `\n## Reference Image\nA reference image is at ./reference.png. Read it and use it as visual inspiration. Do NOT embed it — recreate the visual elements with CSS/SVG/Canvas.\n`);
            } catch {}
        }

        const hasImage = referenceImage && fs.existsSync(path.join(projectDir, 'reference.png'));

        sendStatus('Building your app', prompt.substring(0, 60), 10);

        const buildPrompt = `Build a complete web application: "${prompt.trim()}"
${hasImage ? '\nA reference image is at ./reference.png — read it first and use it as design inspiration.\n' : ''}
Read CLAUDE.md for all requirements and constraints.

Build the full app now. Create index.html as the entry point plus any needed CSS/JS files.
Every feature must be fully implemented and working. No TODOs, no placeholders, no stubs.`;

        const result = direct
            ? await runDirect({ kind: 'generate', prompt, projectDir })
            : await runClaudeCommand(claudePath, buildPrompt, projectDir, requestId, 20);
        outcome.run = result;

        if (!result.success) {
            activeGenerations = Math.max(0, activeGenerations - 1);
            if (result.quotaError) return sendError(getQuotaErrorMessage());
            // Check if files were created despite non-zero exit
            if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
                const htmlFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.html') && f !== 'CLAUDE.md');
                if (htmlFiles.length > 0) {
                    fs.renameSync(path.join(projectDir, htmlFiles[0]), path.join(projectDir, 'index.html'));
                } else {
                    return sendError('No app files were created. Please try again with a different description.');
                }
            }
        }

        // Ensure index.html exists
        if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
            const htmlFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.html') && f !== 'CLAUDE.md');
            if (htmlFiles.length > 0) {
                fs.renameSync(path.join(projectDir, htmlFiles[0]), path.join(projectDir, 'index.html'));
            } else {
                activeGenerations = Math.max(0, activeGenerations - 1);
                return sendError('No app files were created. Please try again with a different description.');
            }
        }

        sendStatus('Packaging app', 'Creating bundle', 95);

        const zip = await zipProjectFolder(projectDir);
        const files = listProjectFiles(projectDir);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(`[${requestId}] App complete in ${elapsed}s (${files.length} files, ${(zip.sizeBytes / 1024).toFixed(1)}KB)`);

        outcome.delivered = true;
        sendResult({
            success: true,
            bundle: zip.base64,
            bundleSize: zip.sizeBytes,
            files,
            generationTime: elapsed,
            quality: { criticalIssues: 0, warnings: 0, phasesCompleted: 1 },
            generator: direct ? 'direct' : 'claude',
            model: result.model || null
        });

    } catch (error) {
        console.error(`[${requestId}] Error:`, error.message);
        sendError('Internal worker error. Please try again.');
    } finally {
        outcome.finish();
        activeGenerations = Math.max(0, activeGenerations - 1);
        if (projectDir) setTimeout(() => cleanupProjectFolder(projectDir), 120000);
    }
});

// ============================================
// POST /customize — Fork and customize from parent bundle
// ============================================

app.post('/customize', authMiddleware, async (req, res) => {
    const { parentBundle, customizeDescription, appTitle, newTitle, stream } = req.body;

    if (!parentBundle) return res.status(400).json({ error: 'parentBundle is required' });
    if (!customizeDescription) return res.status(400).json({ error: 'customizeDescription is required' });
    if (activeGenerations >= MAX_CONCURRENT) return res.status(429).json({ error: 'Worker busy.' });
    const direct = useDirect();
    if (!direct && quotaExhausted) return res.status(503).json({ error: getQuotaErrorMessage(), quotaExhausted: true });

    activeGenerations++;
    const startTime = Date.now();
    const requestId = `cust-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const outcome = makeOutcome(requestId, 'customize', direct);
    let projectDir = null;

    const isSSE = stream === true;
    let heartbeatInterval = null;
    if (isSSE) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        heartbeatInterval = setInterval(() => { try { res.write(':heartbeat\n\n'); } catch {} }, 15000);
        res.on('close', () => { if (heartbeatInterval) clearInterval(heartbeatInterval); });
    }

    function sendError(error) {
        if (isSSE) { res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`); try { res.end(); } catch {} }
        else { res.status(503).json({ error }); }
    }

    function sendResult(data) {
        if (isSSE) { res.write(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`); try { res.end(); } catch {} }
        else { res.json(data); }
    }

    console.log(`[${requestId}] Customize: "${customizeDescription.substring(0, 80)}"`);

    try {
        const claudePath = direct ? null : findClaudeCLI();
        projectDir = path.join(PROJECTS_DIR, requestId);
        fs.mkdirSync(projectDir, { recursive: true });
        unzipBundle(parentBundle, projectDir);
        fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), CLAUDE_MD + '\n## Customization\nModify the existing app. Keep it fully functional. Make only necessary changes.\n');

        if (isSSE) res.write(`data: ${JSON.stringify({ type: 'status', phase: 'generate', message: 'Customizing your app', progressPercent: 10, progressEndPct: 95 })}\n\n`);

        const customizePrompt = `Customize this web application:

Original app: "${appTitle || 'Unknown'}"
New title: "${newTitle || appTitle || 'Unknown'}"
Customization request: "${customizeDescription.trim()}"

Read all existing files first, then apply the changes. Keep all features working.`;

        const result = direct
            ? await runDirect({ kind: 'customize', prompt: customizePrompt, projectDir })
            : await runClaudeCommand(claudePath, customizePrompt, projectDir, requestId, 15);
        outcome.run = result;

        if (direct && !result.success) {
            activeGenerations = Math.max(0, activeGenerations - 1);
            return sendError('Could not apply the customization. Please try again.');
        }
        if (!result.success && result.quotaError) {
            activeGenerations = Math.max(0, activeGenerations - 1);
            return sendError(getQuotaErrorMessage());
        }

        const zip = await zipProjectFolder(projectDir);
        const files = listProjectFiles(projectDir);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${requestId}] Customize complete in ${elapsed}s`);

        outcome.delivered = true;
        sendResult({ success: true, bundle: zip.base64, bundleSize: zip.sizeBytes, files, generationTime: elapsed, generator: direct ? 'direct' : 'claude', model: result.model || null });
    } catch (error) {
        console.error(`[${requestId}] Customize error:`, error.message);
        sendError('Internal error during customization.');
    } finally {
        outcome.finish();
        activeGenerations = Math.max(0, activeGenerations - 1);
        if (projectDir) setTimeout(() => cleanupProjectFolder(projectDir), 120000);
    }
});

// ============================================
// Git Helpers
// ============================================

function checkGitAvailable() {
    try { execSync('git --version', { stdio: 'pipe' }); return true; } catch { return false; }
}

function getRepoName(projectId) { return `app-${projectId}`; }
function getCloneUrl(repoName) { return `https://x-access-token:${GITHUB_PAT}@github.com/${GITHUB_ORG}/${repoName}.git`; }

async function createGitHubRepo(repoName) {
    const response = await fetch(`https://api.github.com/orgs/${GITHUB_ORG}/repos`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, private: true, auto_init: false, description: 'VibeCoder app bundle' }),
    });
    if (response.status === 422) return { success: true, alreadyExists: true };
    if (!response.ok) throw new Error(`GitHub API error ${response.status}`);
    return { success: true };
}

async function getGitCommitHistory(repoName, limit = 20) {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_ORG}/${repoName}/commits?per_page=${limit}`, {
        headers: { 'Authorization': `Bearer ${GITHUB_PAT}`, 'Accept': 'application/vnd.github+json' },
    });
    if (!response.ok) { if (response.status === 409) return []; throw new Error(`GitHub API error ${response.status}`); }
    const commits = await response.json();
    return commits.map(c => ({ sha: c.sha, shortSha: c.sha.substring(0, 7), message: c.commit.message, date: c.commit.author.date, author: c.commit.author.name }));
}

function gitClone(repoName, targetDir) {
    const cloneUrl = getCloneUrl(repoName);
    execSync(`git clone "${cloneUrl}" "${targetDir}"`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    execSync(`git -C "${targetDir}" config user.email "bot@vibecoder.com"`, { stdio: 'pipe' });
    execSync(`git -C "${targetDir}" config user.name "VibeCoder Bot"`, { stdio: 'pipe' });
}

function gitCommitAndPush(repoDir, message, branch = 'main') {
    if (branch !== 'main') {
        try { execSync(`git -C "${repoDir}" checkout ${branch}`, { stdio: 'pipe' }); }
        catch { execSync(`git -C "${repoDir}" checkout -b ${branch}`, { stdio: 'pipe' }); }
    }
    execSync(`git -C "${repoDir}" add -A`, { stdio: 'pipe' });
    try { execSync(`git -C "${repoDir}" diff --cached --quiet`, { stdio: 'pipe' }); return null; } catch {}
    try { execSync(`git -C "${repoDir}" reset HEAD CLAUDE.md`, { stdio: 'pipe' }); } catch {}
    try { execSync(`git -C "${repoDir}" reset HEAD .claude`, { stdio: 'pipe' }); } catch {}
    const safeMessage = message.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    execSync(`git -C "${repoDir}" commit -m "${safeMessage}"`, { stdio: 'pipe' });
    const sha = execSync(`git -C "${repoDir}" rev-parse HEAD`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    execSync(`git -C "${repoDir}" push origin ${branch}`, { stdio: 'pipe', timeout: 60000 });
    return sha;
}

async function initProjectRepo(projectId, base64Bundle) {
    const repoName = getRepoName(projectId);
    await createGitHubRepo(repoName);
    const tempDir = path.join(PROJECTS_DIR, `init-${projectId}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    try {
        execSync(`git init "${tempDir}"`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" config user.email "bot@vibecoder.com"`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" config user.name "VibeCoder Bot"`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" branch -M main`, { stdio: 'pipe' });
        fs.writeFileSync(path.join(tempDir, '.gitignore'), 'CLAUDE.md\n.claude/\n');
        unzipBundle(base64Bundle, tempDir);
        const claudeMdPath = path.join(tempDir, 'CLAUDE.md');
        if (fs.existsSync(claudeMdPath)) fs.unlinkSync(claudeMdPath);
        execSync(`git -C "${tempDir}" add -A`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" commit -m "Initial app creation"`, { stdio: 'pipe' });
        const cloneUrl = getCloneUrl(repoName);
        execSync(`git -C "${tempDir}" remote add origin "${cloneUrl}"`, { stdio: 'pipe' });
        execSync(`git -C "${tempDir}" push -u origin main`, { stdio: 'pipe', timeout: 60000 });
        const sha = execSync(`git -C "${tempDir}" rev-parse HEAD`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        return { success: true, repoName, commitSha: sha };
    } finally {
        setTimeout(() => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }, 5000);
    }
}

// ============================================
// POST /init-repo
// ============================================

app.post('/init-repo', authMiddleware, async (req, res) => {
    const { projectId, bundle } = req.body;
    if (!projectId || !bundle) return res.status(400).json({ error: 'projectId and bundle are required' });
    if (!GITHUB_PAT) return res.status(503).json({ error: 'Git not configured' });
    try {
        const result = await initProjectRepo(projectId, bundle);
        res.json({ success: true, repoName: result.repoName, commitSha: result.commitSha });
    } catch (error) {
        res.status(500).json({ error: `Failed to initialize repo: ${error.message}` });
    }
});

// ============================================
// POST /tweak
// ============================================

app.post('/tweak', authMiddleware, async (req, res) => {
    const { projectId, repoName, tweakDescription, stream } = req.body;
    if (!tweakDescription) return res.status(400).json({ error: 'tweakDescription is required' });
    if (!repoName) return res.status(400).json({ error: 'repoName is required' });
    if (!GITHUB_PAT) return res.status(503).json({ error: 'Git not configured' });
    if (activeGenerations >= MAX_CONCURRENT) return res.status(429).json({ error: 'Worker busy.' });
    const direct = useDirect();
    if (!direct && quotaExhausted) return res.status(503).json({ error: getQuotaErrorMessage(), quotaExhausted: true });

    activeGenerations++;
    const startTime = Date.now();
    const requestId = `tweak-${(projectId || 'x').substring(0, 8)}-${Date.now()}`;
    const outcome = makeOutcome(requestId, 'tweak', direct);
    let projectDir = null;

    const isSSE = stream === true;
    let heartbeatInterval = null;
    if (isSSE) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        heartbeatInterval = setInterval(() => { try { res.write(':heartbeat\n\n'); } catch {} }, 15000);
        res.on('close', () => { if (heartbeatInterval) clearInterval(heartbeatInterval); });
    }

    function sendError(error) {
        if (isSSE) { res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`); try { res.end(); } catch {} }
        else { res.status(503).json({ error }); }
    }

    function sendResult(data) {
        if (isSSE) { res.write(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`); try { res.end(); } catch {} }
        else { res.json(data); }
    }

    console.log(`[${requestId}] Tweak: "${tweakDescription.substring(0, 100)}"`);

    try {
        const claudePath = direct ? null : findClaudeCLI();
        projectDir = path.join(PROJECTS_DIR, requestId);
        fs.mkdirSync(projectDir, { recursive: true });

        if (isSSE) res.write(`data: ${JSON.stringify({ type: 'status', phase: 'generate', message: 'Preparing project', progressPercent: 5 })}\n\n`);

        // Clone repo
        try {
            gitClone(repoName, projectDir + '/repo');
            const repoDir = path.join(projectDir, 'repo');
            for (const file of fs.readdirSync(repoDir)) {
                if (file === '.git') continue;
                fs.renameSync(path.join(repoDir, file), path.join(projectDir, file));
            }
            fs.renameSync(path.join(repoDir, '.git'), path.join(projectDir, '.git'));
            fs.rmSync(repoDir, { recursive: true, force: true });
        } catch (err) {
            activeGenerations = Math.max(0, activeGenerations - 1);
            return sendError(`Failed to clone repo: ${err.message}`);
        }

        fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), CLAUDE_MD + '\n## Tweak Task\nRead all existing files first. Make only the changes needed. Keep the app fully functional.\n');

        if (isSSE) res.write(`data: ${JSON.stringify({ type: 'status', phase: 'generate', message: 'Applying changes', detail: tweakDescription.substring(0, 60), progressPercent: 20 })}\n\n`);

        const tweakPrompt = `The creator wants this change to their web app:\n\n"${tweakDescription.trim()}"\n\nRead all existing files first, then make ONLY the changes needed. Keep everything working.`;

        const result = direct
            ? await runDirect({ kind: 'tweak', prompt: tweakPrompt, projectDir })
            : await runClaudeCommand(claudePath, tweakPrompt, projectDir, requestId, 12);
        outcome.run = result;

        if (direct && !result.success) {
            activeGenerations = Math.max(0, activeGenerations - 1);
            return sendError('Could not apply the change. Please try again.');
        }
        if (!result.success && result.quotaError) {
            activeGenerations = Math.max(0, activeGenerations - 1);
            return sendError(getQuotaErrorMessage());
        }

        if (isSSE) res.write(`data: ${JSON.stringify({ type: 'status', phase: 'package', message: 'Saving changes', progressPercent: 90 })}\n\n`);

        let commitSha = null;
        try { commitSha = gitCommitAndPush(projectDir, `Tweak: ${tweakDescription.substring(0, 200)}`); } catch (err) { console.error(`[${requestId}] Git push failed: ${err.message}`); }

        const zip = await zipProjectFolder(projectDir);
        const files = listProjectFiles(projectDir);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${requestId}] Tweak complete in ${elapsed}s`);

        outcome.delivered = true;
        sendResult({ success: true, bundle: zip.base64, bundleSize: zip.sizeBytes, files, commitSha, generationTime: elapsed, generator: direct ? 'direct' : 'claude', model: result.model || null });
    } catch (error) {
        console.error(`[${requestId}] Tweak error:`, error.message);
        sendError('Internal error during tweak.');
    } finally {
        outcome.finish();
        activeGenerations = Math.max(0, activeGenerations - 1);
        if (projectDir) setTimeout(() => cleanupProjectFolder(projectDir), 120000);
    }
});

// ============================================
// GET /versions/:repoName
// ============================================

app.get('/versions/:repoName', authMiddleware, async (req, res) => {
    if (!GITHUB_PAT) return res.status(503).json({ error: 'Git not configured' });
    try {
        const commits = await getGitCommitHistory(req.params.repoName, parseInt(req.query.limit) || 20);
        res.json({ success: true, versions: commits });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch version history' });
    }
});

// ============================================
// GET /bundle/:repoName
// ============================================

app.get('/bundle/:repoName', authMiddleware, async (req, res) => {
    if (!GITHUB_PAT) return res.status(503).json({ error: 'Git not configured' });
    const tmpDir = path.join(os.tmpdir(), `bundle-${crypto.randomUUID()}`);
    try {
        fs.mkdirSync(tmpDir, { recursive: true });
        const repoUrl = `https://x-access-token:${GITHUB_PAT}@github.com/${GITHUB_ORG}/${req.params.repoName}.git`;
        execSync(`git clone --depth 1 ${repoUrl} ${tmpDir}/project`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
        const projectDir = path.join(tmpDir, 'project');
        const gitDir = path.join(projectDir, '.git');
        if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true, force: true });
        const zip = await zipProjectFolder(projectDir);
        res.json({ success: true, bundle: zip.base64, bundleSize: zip.sizeBytes });
    } catch (error) {
        res.status(500).json({ error: `Failed to fetch bundle: ${error.message}` });
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
});

// ============================================
// POST /build-apk
// ============================================

function deriveAppName(rawName) {
    let name = rawName.trim()
        .replace(/^(build|create|make|design|develop)\s+(a|an|the|me\s+a|me\s+an)?\s*/i, '')
        .replace(/\s+(with|that|where|which|for|using|featuring|including)\s+.*/i, '');
    name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').substring(0, 30).trim();
    if (!name || name.length < 2) name = 'My App';
    return name.replace(/[<>&"']/g, '');
}

const APK_TEMPLATE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'apk-template');
let activeApkBuilds = 0;

app.post('/build-apk', authMiddleware, async (req, res) => {
    const { projectId, bundle, appName } = req.body;
    if (!bundle) return res.status(400).json({ error: 'bundle is required' });
    if (!appName) return res.status(400).json({ error: 'appName is required' });
    if (activeApkBuilds >= 1) return res.status(429).json({ error: 'APK build queue full. Try again in a minute.' });

    activeApkBuilds++;
    const buildId = `apk-${(projectId || 'x').substring(0, 8)}`;
    const tmpDir = path.join(os.tmpdir(), `apk-build-${crypto.randomUUID()}`);

    try {
        fs.mkdirSync(tmpDir, { recursive: true });
        execSync(`cp -r ${APK_TEMPLATE_DIR}/. ${tmpDir}/`, { stdio: 'pipe' });

        const assetsDir = path.join(tmpDir, 'app', 'src', 'main', 'assets');
        fs.mkdirSync(assetsDir, { recursive: true });
        unzipBundle(bundle, assetsDir);

        const stringsPath = path.join(tmpDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
        const cleanAppName = deriveAppName(appName);
        fs.writeFileSync(stringsPath, fs.readFileSync(stringsPath, 'utf-8').replace('VibeBuild App', cleanAppName));

        const appGradle = path.join(tmpDir, 'app', 'build.gradle.kts');
        const appIdSuffix = 'a' + (projectId || 'app').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20).toLowerCase();
        fs.writeFileSync(appGradle, fs.readFileSync(appGradle, 'utf-8').replace('applicationId = "com.vibebuild.export"', `applicationId = "com.vibebuild.app.${appIdSuffix}"`));

        console.log(`[${buildId}] Building APK for "${cleanAppName}"...`);
        execSync('./gradlew assembleRelease', {
            cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000,
            env: { ...process.env, ANDROID_HOME: '/opt/android-sdk', JAVA_HOME: '/usr/lib/jvm/java-17-openjdk-amd64', PATH: `${process.env.PATH}:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools` }
        });

        const apkPath = path.join(tmpDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
        if (!fs.existsSync(apkPath)) throw new Error('APK not found after build');
        const apkBuffer = fs.readFileSync(apkPath);
        console.log(`[${buildId}] APK ready: ${(apkBuffer.length / 1024 / 1024).toFixed(1)}MB`);
        res.json({ success: true, apk: apkBuffer.toString('base64'), apkSize: apkBuffer.length });
    } catch (error) {
        console.error(`[${buildId}] APK build failed:`, error.message);
        res.status(500).json({ error: `APK build failed: ${error.message}` });
    } finally {
        activeApkBuilds--;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
});

// ============================================
// Start
// ============================================

checkGitAvailable();


// ============================================
// POST /revert
// Restores a project to an older commit by replaying that commit's tree as
// a new commit on main. Preserves history (no destructive rewrites).
// Body: { repoName, commitSha }
// Returns: { success, commitSha (new), bundle, bundleSize }
// ============================================

app.post('/revert', authMiddleware, async (req, res) => {
    const { repoName, commitSha } = req.body;
    if (!repoName) return res.status(400).json({ error: 'repoName is required' });
    if (!commitSha) return res.status(400).json({ error: 'commitSha is required' });
    if (!GITHUB_PAT) return res.status(503).json({ error: 'Git not configured' });

    const requestId = `revert-${repoName.substring(0, 12)}-${Date.now()}`;
    const projectDir = path.join(PROJECTS_DIR, requestId);
    fs.mkdirSync(projectDir, { recursive: true });

    try {
        // Clone the repo and lay it out the way /tweak does (files at projectDir root).
        gitClone(repoName, projectDir + '/repo');
        const repoDir = path.join(projectDir, 'repo');
        for (const file of fs.readdirSync(repoDir)) {
            if (file === '.git') continue;
            fs.renameSync(path.join(repoDir, file), path.join(projectDir, file));
        }
        fs.renameSync(path.join(repoDir, '.git'), path.join(projectDir, '.git'));
        fs.rmSync(repoDir, { recursive: true, force: true });

        // Make sure the target sha exists locally.
        try {
            execSync(`git -C "${projectDir}" cat-file -e ${commitSha}^{commit}`, { stdio: 'pipe' });
        } catch {
            return res.status(400).json({ error: `Commit ${commitSha.substring(0, 7)} not found in repo` });
        }

        // Replay the target tree onto the index + working tree, leaving HEAD on
        // main. The next commit becomes a forward-revert: new commit on main
        // whose tree equals the older version. Avoids destructive history.
        execSync(`git -C "${projectDir}" checkout main`, { stdio: 'pipe' });
        execSync(`git -C "${projectDir}" read-tree -u --reset ${commitSha}`, { stdio: 'pipe' });

        const short = commitSha.substring(0, 7);
        const newSha = gitCommitAndPush(projectDir, `Revert to ${short}`);

        const zip = await zipProjectFolder(projectDir);
        console.log(`[${requestId}] Reverted to ${short} (new commit ${(newSha || '').substring(0, 7)})`);

        res.json({
            success: true,
            commitSha: newSha || commitSha,
            bundle: zip.base64,
            bundleSize: zip.sizeBytes
        });
    } catch (err) {
        console.error(`[${requestId}] Revert failed:`, err.message);
        res.status(500).json({ error: `Revert failed: ${err.message}` });
    } finally {
        setTimeout(() => cleanupProjectFolder(projectDir), 120000);
    }
});

app.listen(PORT, () => {
    let cliPath = 'NOT FOUND';
    try { cliPath = findClaudeCLI(); } catch {}
    console.log(`VibeCoder Worker running on http://localhost:${PORT}`);
    console.log(`Claude CLI: ${cliPath}`);
    console.log(`Projects: ${PROJECTS_DIR}`);
    console.log(`Max concurrent: ${MAX_CONCURRENT}`);
    console.log(`GitHub PAT: ${GITHUB_PAT ? '***configured***' : 'NOT SET'}`);
    console.log(`Git available: ${checkGitAvailable()}`);
});
