// RiddleVerse game endpoints, served under /game/* so VibeBuild's own /generate, /customize, /tweak are untouched.
// RiddleVerse calls ${GAME_WORKER_URL}/generate, /generate-harder, /generate-next-level, /customize, /tweak, /init-repo and
// /versions/:repo; pointing GAME_WORKER_URL at http://<worker>:3456/game reaches these routes with no change to RiddleVerse.
// Same SSE contract as the original game worker: {type:'status'|'result'|'error'} events, base64 ZIP bundle, quality block.
// Always the direct (OpenRouter) generator; the Claude CLI / broker is never used here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateApp } from './generate.js';
import { readProject, writeFiles } from './files.js';
import { fullChecks } from './browsercheck.js';
import { scanGenerated, allowedHostsFor, userMessageForCause } from './scan.js';
import { scrubSecrets } from './scrub.js';
import {
    GAME_RULES, createPrompt, harderPrompt, nextLevelPrompt, customizePrompt, tweakPrompt,
    makeGameCheck, qualityOf, extractTitle, validateHarder, validateNextLevel,
} from './gameRules.js';

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeText = (s) => scrubSecrets(String(s ?? '')).text; // credentials pasted by a player never reach a provider

/**
 * deps: { authMiddleware, llm, models, slot:{acquire(),release()}, makeOutcome(requestId, kind, direct),
 *         zipProjectFolder, listProjectFiles, unzipBundle, projectsDir, deadlineMs,
 *         git:{ pat, clone(repo,dir), commitAndPush(dir,msg), init(id,bundle), history(repo,limit) } }
 */
export function registerGameRoutes(app, deps) {
    const { authMiddleware, llm, models, slot, makeOutcome, zipProjectFolder, listProjectFiles, unzipBundle, projectsDir, git } = deps;
    const deadlineMs = deps.deadlineMs || 480000;
    const baseCheck = (files) => fullChecks(files, { vibe: false });
    const scan = (files) => scanGenerated(files, { allowedHosts: allowedHostsFor(undefined) });

    async function generate({ kind, prompt, existing, extraCheck }) {
        const r = await generateApp({ prompt, kind, existing, llm, models, rules: GAME_RULES, check: makeGameCheck(baseCheck, extraCheck), scan, deadlineMs });
        if (!r.ok) return { success: false, cause: r.cause, attempts: r.attempts, costUsd: r.costUsd };
        return { success: true, files: r.files, model: r.model, attempts: r.attempts, costUsd: r.costUsd, fixes: r.fixes };
    }

    /** Shared request lifecycle. build({body, projectDir, status}) -> {success, files, ...run} | {success:false, cause, message}. */
    async function lifecycle(req, res, { label, validate, build, extra, failMessage }) {
        const body = req.body || {};
        const bad = validate ? validate(body) : null;
        if (bad) return res.status(400).json({ error: bad });
        if (!llm) return res.status(503).json({ error: 'Game builds are not available on this worker.' });
        if (!slot.acquire()) return res.status(429).json({ error: 'Worker busy. Try again in a moment.' });

        const startTime = Date.now();
        const requestId = `game-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const outcome = makeOutcome(requestId, `game_${label}`, true);
        const isSSE = body.stream === true;
        let heartbeat = null;
        let projectDir = null;
        if (isSSE) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();
            heartbeat = setInterval(() => { try { res.write(':heartbeat\n\n'); } catch { /* client gone */ } }, 15000);
            res.on('close', () => { if (heartbeat) clearInterval(heartbeat); });
        }
        const status = (phase, message, detail, progressPercent, progressEndPct, typical, remaining, more = {}) => {
            console.log(`[${requestId}] [${phase}] ${message}${detail ? ': ' + detail : ''}`);
            if (isSSE) res.write(`data: ${JSON.stringify({ type: 'status', phase, message, detail, progressPercent, progressEndPct, phaseDurationSeconds: typical, estimatedSecondsRemaining: remaining, ...more })}\n\n`);
        };
        const sendError = (error, code = 503) => {
            if (isSSE) { res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`); try { res.end(); } catch { /* closed */ } }
            else res.status(code).json({ error });
        };
        const sendResult = (data) => {
            if (isSSE) { res.write(`data: ${JSON.stringify({ type: 'result', ...data })}\n\n`); try { res.end(); } catch { /* closed */ } }
            else res.json(data);
        };

        try {
            projectDir = path.join(projectsDir, requestId);
            fs.mkdirSync(projectDir, { recursive: true });
            const r = await build({ body, projectDir, status });
            outcome.run = r;
            if (!r.success) return sendError(r.message || userMessageForCause(r.cause, failMessage));
            status('verify', 'Final verification', 'Ensuring everything works', 90, 95, 1, 2);
            writeFiles(projectDir, r.files);
            const quality = qualityOf(r.files, { phasesCompleted: 3 });
            status('package', 'Packaging game', 'Creating downloadable bundle', 95, 100, 1, 1);
            const zip = await zipProjectFolder(projectDir);
            const files = listProjectFiles(projectDir);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[${requestId}] done in ${elapsed}s (${files.length} files, ${(zip.sizeBytes / 1024).toFixed(1)}KB, ${quality.criticalIssues} critical, model ${r.model}, $${(r.costUsd || 0).toFixed(4)})`);
            outcome.delivered = true;
            sendResult({
                success: true, bundle: zip.base64, bundleSize: zip.sizeBytes, files, generationTime: elapsed, quality,
                generator: 'direct', model: r.model || null, costUsd: r.costUsd || 0,
                ...(extra ? await extra({ body, r, projectDir, requestId }) : {}),
            });
        } catch (error) {
            console.error(`[${requestId}] error:`, error.message);
            sendError(error.userMessage || 'Internal worker error. Please try again.', error.userMessage ? 400 : 500);
        } finally {
            if (heartbeat) clearInterval(heartbeat);
            outcome.finish();
            slot.release();
            if (projectDir) setTimeout(() => { try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* best effort */ } }, 120000).unref();
        }
    }

    const inputError = (message) => Object.assign(new Error(message), { userMessage: message });
    function unpackParent(parentBundle, dir) {
        try { unzipBundle(parentBundle, dir); } catch { throw inputError('parentBundle is not a valid ZIP bundle'); }
        const p = readProject(dir);
        if (p.tooLarge) throw inputError('The game is too large to edit directly.');
        if (!p.files['index.html']) throw inputError('parentBundle has no index.html');
        return p.files;
    }

    // ---- POST /game/generate
    app.post('/game/generate', authMiddleware, (req, res) => lifecycle(req, res, {
        label: 'generate',
        validate: (b) => (typeof b.prompt === 'string' && b.prompt.trim() ? null : 'Game description is required'),
        failMessage: 'Failed to generate game. Please try again.',
        build: async ({ body, status }) => {
            status('generate', 'Building your game', 'Creating game files from your description', 0, 90, 90, 100);
            return generate({ kind: 'generate', prompt: createPrompt(safeText(body.prompt), { hasReference: !!body.referenceImage }) });
        },
        extra: ({ body, r }) => ({ suggestedTitle: extractTitle(r.files) || clean(body.prompt, 60), suggestedDescription: clean(body.prompt, 500) }),
    }));

    // ---- POST /game/generate-harder
    app.post('/game/generate-harder', authMiddleware, (req, res) => lifecycle(req, res, {
        label: 'harder',
        validate: validateHarder,
        failMessage: 'Failed to generate harder version. Please try again.',
        build: async ({ body, projectDir, status }) => {
            const level = Number(body.difficultyLevel);
            status('generate', 'Preparing harder challenge', `Creating level ${level} of ${clean(body.gameTitle, 80)}`, 0, 90, 90, 100);
            const existing = unpackParent(body.parentBundle, projectDir);
            return generate({ kind: 'harder', existing, prompt: harderPrompt({ gameTitle: safeText(body.gameTitle), difficultyLevel: level }) });
        },
        extra: ({ body }) => ({ difficultyLevel: Number(body.difficultyLevel), commitSha: null }),
    }));

    // ---- POST /game/generate-next-level
    app.post('/game/generate-next-level', authMiddleware, (req, res) => lifecycle(req, res, {
        label: 'nextlevel',
        validate: validateNextLevel,
        failMessage: 'Failed to generate next level. Please try again.',
        build: async ({ body, projectDir, status }) => {
            const n = Number(body.nextLevelIndex);
            const seriesTitle = clean(safeText(body.seriesTitle), 100) || 'Game';
            status('generate', `Generating Level ${n}`, `Reading previous level to extend "${seriesTitle}"`, 0, 90, 90, 100, { suggestedTitle: `${seriesTitle} — Level ${n}` });
            const previousFiles = unpackParent(body.parentBundle, projectDir);
            // the new level starts a fresh project: remove the parent's files so only new output is bundled
            fs.rmSync(projectDir, { recursive: true, force: true });
            fs.mkdirSync(projectDir, { recursive: true });
            const parentIndex = previousFiles['index.html'];
            return generate({
                kind: 'generate',
                prompt: nextLevelPrompt({ seriesTitle, seriesDescription: safeText(body.seriesDescription), parentLevelIndex: Number(body.parentLevelIndex) || n - 1, nextLevelIndex: n, previousFiles }),
                extraCheck: (files) => (files['index.html'] === parentIndex ? ['the new level is identical to the previous level: write genuinely new content'] : []),
            });
        },
        extra: ({ body, r }) => {
            const n = Number(body.nextLevelIndex);
            const seriesTitle = clean(body.seriesTitle, 100) || 'Game';
            return { nextLevelIndex: n, suggestedTitle: extractTitle(r.files) || `${seriesTitle} — Level ${n}`, suggestedDescription: `Level ${n} of ${seriesTitle}` };
        },
    }));

    // ---- POST /game/customize
    app.post('/game/customize', authMiddleware, (req, res) => lifecycle(req, res, {
        label: 'customize',
        validate: (b) => (!b.parentBundle ? 'parentBundle is required' : !b.customizeDescription ? 'customizeDescription is required' : null),
        failMessage: 'Could not apply the customization. Please try again.',
        build: async ({ body, projectDir, status }) => {
            status('generate', 'Preparing customization', `Applying changes to ${clean(body.gameTitle, 80)}`, 0, 90, 90, 100);
            const existing = unpackParent(body.parentBundle, projectDir);
            return generate({ kind: 'customize', existing, prompt: customizePrompt({ gameTitle: safeText(body.gameTitle), newTitle: safeText(body.newTitle), customizeDescription: safeText(body.customizeDescription) }) });
        },
    }));

    // ---- POST /game/tweak (git-backed: clone, edit, commit, push)
    app.post('/game/tweak', authMiddleware, (req, res) => {
        const b = req.body || {};
        if (!b.tweakDescription || typeof b.tweakDescription !== 'string' || !b.tweakDescription.trim()) return res.status(400).json({ error: 'tweakDescription is required' });
        if (!b.repoName) return res.status(400).json({ error: 'repoName is required (initialize repo first)' });
        if (!git?.pat) return res.status(503).json({ error: 'Git integration not configured (missing GITHUB_PAT)' });
        return lifecycle(req, res, {
            label: 'tweak',
            failMessage: 'Could not apply the change. Please try again.',
            build: async ({ body, projectDir, status }) => {
                status('generate', 'Preparing project', undefined, 0, 90, 90, 100);
                try {
                    git.clone(body.repoName, path.join(projectDir, 'repo'));
                    const repoDir = path.join(projectDir, 'repo');
                    for (const f of fs.readdirSync(repoDir)) {
                        if (f === '.git') continue;
                        fs.renameSync(path.join(repoDir, f), path.join(projectDir, f));
                    }
                    fs.renameSync(path.join(repoDir, '.git'), path.join(projectDir, '.git'));
                    fs.rmSync(repoDir, { recursive: true, force: true });
                } catch (e) {
                    throw inputError(`Failed to clone repo: ${clean(e.message, 120)}`);
                }
                const p = readProject(projectDir);
                if (p.tooLarge) throw inputError('The game is too large to edit directly.');
                if (!p.files['index.html']) throw inputError('The repository has no index.html');
                return generate({ kind: 'tweak', existing: p.files, prompt: tweakPrompt({ tweakDescription: safeText(body.tweakDescription) }) });
            },
            extra: ({ body, projectDir, requestId }) => {
                let commitSha = null;
                try { commitSha = git.commitAndPush(projectDir, `Tweak: ${clean(body.tweakDescription, 200)}`); } catch (e) { console.error(`[${requestId}] git push failed (non-fatal): ${clean(e.message, 120)}`); }
                return { commitSha };
            },
        });
    });

    // ---- POST /game/init-repo
    app.post('/game/init-repo', authMiddleware, async (req, res) => {
        const { gameId, bundle } = req.body || {};
        if (!gameId || !bundle) return res.status(400).json({ error: 'gameId and bundle are required' });
        if (!git?.pat) return res.status(503).json({ error: 'Git integration not configured (missing GITHUB_PAT)' });
        try {
            const r = await git.init(String(gameId), bundle);
            res.json({ success: true, repoName: r.repoName, commitSha: r.commitSha });
        } catch (e) {
            res.status(500).json({ error: `Failed to initialize repo: ${clean(e.message, 120)}` });
        }
    });

    // ---- GET /game/versions/:repoName
    app.get('/game/versions/:repoName', authMiddleware, async (req, res) => {
        if (!git?.pat) return res.status(503).json({ error: 'Git integration not configured' });
        try {
            res.json({ success: true, versions: await git.history(req.params.repoName, parseInt(req.query.limit, 10) || 20) });
        } catch {
            res.status(500).json({ error: 'Failed to fetch version history' });
        }
    });

    // ---- GET /game/ping: authenticated, free, says whether the game routes can build
    app.get('/game/ping', authMiddleware, (req, res) => res.json({ ok: true, direct: !!llm, models: models || [], git: !!git?.pat }));
}
