// Game-specific rules, prompts and checks for the RiddleVerse game endpoints (served under /game/* by gameRoutes.js).
// Pure functions only (no I/O) so they can be unit-tested. VibeBuild's own /generate path does not import this file.

/** System rules for every game build (the direct generator appends its own OUTPUT FORMAT block after these). */
export const GAME_RULES = `# Game Creation Project

You are building a self-contained game that runs in a mobile WebView (iOS and Android).
The game is packaged as a small web project and played on the user's phone.

## Project Structure
index.html is the entry point (REQUIRED). A simple game may be a single index.html; a larger one may add css/style.css, js/game.js and so on.
Everything the game needs must be local or inline.

## Absolute Rules
- No external dependencies: no CDNs, no fetch calls to external APIs, no external fonts or images. No http://, https:// or // in src/href attributes.
- No node_modules, no bundlers: pure browser project.
- Mobile-first: touch events (or pointer events) are required. Large touch targets (minimum 44px). Viewport meta required.
- Self-contained: the game must work offline with no internet connection.

## Rendering Environment
The game runs in a standard mobile browser viewport (WebView). It behaves like a normal webpage.
- If the content fits on one screen, use height: 100vh on the container.
- If the content is taller than the viewport, let it scroll naturally. Do NOT use overflow: hidden on html or body.
- The viewport is portrait mobile, roughly 390x844 (varies by device). Do not assume rotation or resizing.
- Multiple choice or Q&A answer buttons: NEVER use absolute positioning or fixed heights for the option container. Use a scrollable flex column so 4+ options are reachable on small screens (375x667). Each button: min-height 52px, width 100%, white-space normal.

## Required in index.html
1. <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
2. html, body { margin: 0; padding: 0; width: 100%; height: 100vh; overflow: visible; }
3. A visible score display that updates during play
4. A Game Over screen with the final score and a "Play Again" button that fully resets the game
5. Brief on-screen instructions
6. A <title> in <head> that is a short, catchy name for THIS game (3-8 words). Never "Game", "Document" or "Untitled". The platform reads this title to name the game.

## Score Reporting Bridge (CRITICAL)
Include this function exactly and call it throughout the game:
\`\`\`js
function reportScore(score, isGameOver) {
    try {
        if (window.webkit?.messageHandlers?.gameScore) {
            window.webkit.messageHandlers.gameScore.postMessage({score: score, gameOver: isGameOver});
        }
        if (window.AndroidBridge) {
            if (isGameOver) window.AndroidBridge.gameOver(score);
            else window.AndroidBridge.postScore(score);
        }
    } catch(e) {}
}
\`\`\`
Call reportScore(score, false) whenever the score changes.
Call reportScore(finalScore, true) exactly when the game ends.

## Assets
You cannot use external images or audio. Use inline SVG, CSS art, emoji, canvas drawing, Web Audio API for sound effects, and small data URIs.

## Design Guidelines
- Dark background (#1a1a2e or similar) with vibrant accent colors
- Smooth animations (requestAnimationFrame for game loops)
- Playable and fun within 1-3 minutes, with a clear end state (win, lose, time up or lives exhausted); never an infinite game
- Add feedback: particles, color flashes, short sound effects, a title screen

## No Placeholder Code
- No TODO comments, placeholder functions, stubs or "implement later"
- Every function fully implemented, every referenced function or variable defined
- Mentally play the game from start screen to game over to restart: a player must be able to finish it
`;

export const DIFFICULTY_DESCRIPTIONS = {
    2: 'Slightly faster speed, more obstacles, shorter timers, slightly smaller targets',
    3: 'Noticeably harder: faster enemies, more complex patterns, tighter timing',
    4: 'Very challenging: multiple simultaneous threats, precision required, tight margins',
    5: 'Expert mode: maximum speed, minimal margins, requires mastery to survive',
};
const DIFFICULTY_BADGE = { 2: 'HARDER', 3: 'HARD', 4: 'VERY HARD', 5: 'EXPERT' };

const clean = (s, max = 500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const q = (s) => String(s).replace(/"/g, "'");

/** User text for a brand-new game. generateApp wraps this in "Create a complete web application for this user request: ...". */
export function createPrompt(prompt, { hasReference = false } = {}) {
    return `Build a complete, playable mobile GAME from this description: ${q(clean(prompt, 2000))}. Follow the game rules in the system message (reportScore bridge, touch controls, Game Over screen with Play Again, catchy <title>).${hasReference ? ' A reference image was provided but cannot be shown to you; ignore it.' : ''}`;
}

export function harderPrompt({ gameTitle, difficultyLevel }) {
    const lvl = Number(difficultyLevel);
    return `The existing game "${q(clean(gameTitle, 100) || 'this game')}" is at difficulty level ${lvl - 1}. Create difficulty level ${lvl} (out of 5).
Target difficulty: ${DIFFICULTY_DESCRIPTIONS[lvl] || DIFFICULTY_DESCRIPTIONS[5]}
RULES:
- Keep the same game concept, visual style and core mechanic.
- Keep the reportScore bridge function exactly as it is.
- Change difficulty parameters only (speed, counts, timing, size, complexity, spawn rates), as targeted edits. Do not rewrite the game.
- Add or update a visible on-screen difficulty badge reading "${DIFFICULTY_BADGE[lvl] || 'EXPERT'}" or "Level ${lvl}".
- The game must remain playable: hard, not impossible.
Return the changed files, each complete.`;
}

export function customizePrompt({ gameTitle, newTitle, customizeDescription }) {
    const title = clean(gameTitle, 100) || 'this game';
    const nt = clean(newTitle, 100);
    return `A player wants this customization to the game "${q(title)}": "${q(clean(customizeDescription, 800))}"
${nt && nt !== title ? `The customized game should be titled "${q(nt)}" (use it as the <title>).\n` : ''}Make only the changes needed. Keep the game fully functional, keep the reportScore bridge exactly as it is, keep touch support, and do not rewrite the whole game.`;
}

export function tweakPrompt({ tweakDescription }) {
    return `The creator wants this change to their game: "${q(clean(tweakDescription, 800))}"
Make only the changes needed. Keep the game fully functional, keep the reportScore bridge exactly as it is, keep touch support and the existing visual style unless the change asks otherwise, and do not rewrite the whole game.`;
}

/** previousFiles: { path: text } of the previous level. Returns a self-contained prompt (the model starts a NEW project). */
export function nextLevelPrompt({ seriesTitle, seriesDescription, parentLevelIndex, nextLevelIndex, previousFiles }) {
    const prev = Object.entries(previousFiles || {}).map(([p, c]) => `<previous-level-file path="${p}">\n${c}\n</previous-level-file>`).join('\n');
    return `You are writing the NEXT LEVEL of an existing game series.
Series: "${q(clean(seriesTitle, 100))}"
Series description: "${q(clean(seriesDescription, 300)) || '(none provided)'}"
You are writing Level ${nextLevelIndex}. The player just beat Level ${parentLevelIndex}.

REQUIREMENTS:
- Keep the core gameplay loop, controls, visual style and audio feel of the previous level.
- Introduce NEW content: new enemies, obstacles, mechanics, scenes, objectives or twists. Do NOT merely speed up the previous level or change constants.
- Scale the challenge up modestly; the player just beat the previous level.
- Keep the same reportScore bridge function exactly as in the previous level.
- The <title> of index.html MUST be a short evocative name for THIS level (3-8 words).
- Write a complete new project (index.html at the root). Do not output the previous level's files unchanged.

PREVIOUS LEVEL (read-only reference):
${prev}`;
}

// ---------------------------------------------------------------- checks

const TODO_PATTERNS = [/\/\/\s*TODO/i, /\/\/\s*FIXME/i, /\/\*\s*TODO/i, /implement\s+(this|later|here)/i, /not\s+implemented/i, /coming\s+soon/i];

const sourcesOf = (files) => Object.entries(files || {}).filter(([p]) => /\.(html?|js|css)$/i.test(p));

/** Returns { critical: string[], warnings: string[] }. Critical ones fail the build check and go to the fix pass. */
export function gameProblems(files) {
    const critical = [];
    const warnings = [];
    const src = sourcesOf(files);
    const all = src.map(([, c]) => c).join('\n');

    if (!/reportScore/.test(all) && !(/webkit\.messageHandlers/.test(all) || /AndroidBridge/.test(all))) {
        critical.push('missing score reporting bridge: add the reportScore(score, isGameOver) function from the rules and call it when the score changes and when the game ends');
    } else if (/reportScore/.test(all) && !/reportScore\s*\([^)]*,\s*true\s*\)/.test(all) && !/reportScore\s*\([^)]*\bisGameOver\b/.test(all.replace(/function\s+reportScore\s*\([^)]*\)/, ''))) {
        warnings.push('reportScore is never called with isGameOver=true; call reportScore(finalScore, true) when the game ends');
    }
    if (!/touchstart|touchmove|touchend|pointerdown|pointermove|pointerup|onclick|addEventListener\(\s*['"]click/i.test(all)) {
        critical.push('no touch, pointer or click handlers found: the game must be playable on a phone');
    }
    const html = (files || {})['index.html'] || '';
    if (html) {
        const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
            .filter((r) => !/^(https?:|\/\/|#|data:|mailto:|javascript:)/i.test(r));
        for (const r of refs) {
            const rel = r.replace(/^\.?\//, '').split(/[?#]/)[0];
            if (rel && !(rel in files)) critical.push(`broken file reference in index.html: "${r}" is not one of the project files`);
        }
    }
    for (const [p, c] of src) {
        const lines = c.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (TODO_PATTERNS.some((re) => re.test(lines[i]))) { warnings.push(`incomplete code in ${p}:${i + 1}`); break; }
        }
    }
    if (!/gameOver|game_over|game-over|endGame|isGameOver|gameover/i.test(all)) warnings.push('no game-over state detected');
    if (!/restart|playAgain|play again|resetGame|newGame|startGame/i.test(all)) warnings.push('no replay or restart mechanism detected');
    return { critical, warnings };
}

/** The game's <title>, cleaned the same way RiddleVerse's extractGameTitleFromBundle does; null when missing or a placeholder. */
export function extractTitle(files) {
    const html = (files || {})['index.html'];
    if (!html) return null;
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!m) return null;
    const raw = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
    if (!raw || raw.length < 2 || raw.length > 100) return null;
    if (['document', 'untitled', 'game', 'index', 'title', 'html', 'page', 'default'].includes(raw.toLowerCase())) return null;
    return raw;
}

/**
 * Wraps a base check (VibeBuild's static + browser checks) with the game checks.
 * extra(files) may return additional problem strings (e.g. "next level is identical to the previous one").
 */
export function makeGameCheck(baseCheck, extra = null) {
    return async (files) => {
        const b = await baseCheck(files);
        const g = gameProblems(files);
        const problems = [...(b.problems || []), ...g.critical, ...(extra ? extra(files) : [])];
        return problems.length ? { ok: false, hasApp: b.hasApp, problems } : b;
    };
}

/** Quality block RiddleVerse stores (critical_issues column). Computed on the final files. */
export function qualityOf(files, { phasesCompleted = 3 } = {}) {
    const g = gameProblems(files);
    return { criticalIssues: g.critical.length, warnings: g.warnings.length, phasesCompleted };
}

/** Validates the harder/next-level request fields. Returns an error string or null. */
export function validateHarder(body) {
    if (!body || typeof body.parentBundle !== 'string' || !body.parentBundle) return 'parentBundle is required (base64 ZIP)';
    const l = Number(body.difficultyLevel);
    if (!Number.isInteger(l) || l < 2 || l > 5) return 'difficultyLevel must be 2-5';
    return null;
}
export function validateNextLevel(body) {
    if (!body || typeof body.parentBundle !== 'string' || !body.parentBundle) return 'parentBundle is required (base64 ZIP)';
    const n = Number(body.nextLevelIndex);
    if (!Number.isInteger(n) || n < 2) return 'nextLevelIndex must be >= 2';
    return null;
}
