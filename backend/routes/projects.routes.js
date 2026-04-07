import express from 'express';
import { supabase } from '../config/database.js';
import {
    WORKER_URL,
    WORKER_SECRET,
    DEPLOY_SERVER_URL,
    GENERATION_COST,
    TWEAK_COST,
    FORK_COST,
    CREATOR_SHARE_PCT,
    FREE_TWEAKS_DEFAULT,
    FREE_GENERATIONS_PER_DAY,
    RATE_LIMIT_WINDOW,
    MAX_GENERATIONS_PER_HOUR,
    CACHE_REFRESH_INTERVAL,
    SUGGESTIONS_CACHE_REFRESH_INTERVAL
} from '../config/constants.js';
import { checkUsageLimit, recordUsage, ACTION_TYPES } from '../services/subscriptionService.js';
import { sendPushToUser, sendAPNsPush } from '../services/pushService.js';

const router = express.Router();

// ============================================
// View tracking deduplication (in-memory, 1hr TTL)
// ============================================
const viewDedup = new Map(); // key: `${ip}:${projectId}` → timestamp

function hasRecentView(ip, projectId) {
    const key = `${ip}:${projectId}`;
    const last = viewDedup.get(key);
    if (last && Date.now() - last < 3600000) return true;
    viewDedup.set(key, Date.now());
    return false;
}

// Play tracking deduplication (in-memory, 1hr TTL)
const playDedup = new Map();

function hasRecentPlay(ip, projectId) {
    const key = `${ip}:${projectId}`;
    const last = playDedup.get(key);
    if (last && Date.now() - last < 3600000) return true;
    playDedup.set(key, Date.now());
    return false;
}

// Clean up dedup caches every 30 minutes
setInterval(() => {
    const cutoff = Date.now() - 3600000;
    for (const [key, ts] of viewDedup) { if (ts < cutoff) viewDedup.delete(key); }
    for (const [key, ts] of playDedup) { if (ts < cutoff) playDedup.delete(key); }
}, 1800000);

// ============================================
// Rate limit tracking (in-memory)
// ============================================
const generationLimits = new Map();

function checkRateLimit(userId) {
    const now = Date.now();
    const key = userId || 'anonymous';
    const userLimits = generationLimits.get(key) || [];
    const recentRequests = userLimits.filter(t => now - t < RATE_LIMIT_WINDOW);
    generationLimits.set(key, recentRequests);
    return recentRequests.length < MAX_GENERATIONS_PER_HOUR;
}

function recordGeneration(userId) {
    const key = userId || 'anonymous';
    const userLimits = generationLimits.get(key) || [];
    userLimits.push(Date.now());
    generationLimits.set(key, userLimits);
}

// ============================================
// Browse Cache — read-only in-memory cache
// Updated periodically from DB. Writes (save) happen separately.
// ============================================
let browseCache = {
    newest: [],   // sorted by created_at desc
    popular: [],  // sorted by view_count desc
    totalCount: 0,
    lastRefreshed: 0,
    isRefreshing: false,
};

async function refreshBrowseCache() {
    if (browseCache.isRefreshing) return;
    browseCache.isRefreshing = true;
    try {
        const selectFields = 'id, title, description, creator_id, creator_name, project_type, view_count, play_count, fork_count, like_count, created_at, published_url, preview_url, thumbnail_url, status, initial_prompt';
        const selectFieldsFallback = 'id, title, description, creator_id, creator_name, project_type, view_count, play_count, fork_count, like_count, created_at, published_url, preview_url, status, initial_prompt';

        let [newestResult, popularResult] = await Promise.all([
            supabase
                .from('projects')
                .select(selectFields, { count: 'exact' })
                .eq('is_public', true)
                .eq('status', 'ready')
                .order('created_at', { ascending: false })
                .limit(200),
            supabase
                .from('projects')
                .select(selectFields)
                .eq('is_public', true)
                .eq('status', 'ready')
                .order('play_count', { ascending: false })
                .limit(200),
        ]);

        // Fallback if thumbnail_url column doesn't exist yet
        if (newestResult.error?.code === '42703' || popularResult.error?.code === '42703') {
            console.log('[cache] thumbnail_url column not found, falling back without it');
            [newestResult, popularResult] = await Promise.all([
                supabase.from('projects').select(selectFieldsFallback, { count: 'exact' })
                    .eq('is_public', true).eq('status', 'ready')
                    .order('created_at', { ascending: false }).limit(200),
                supabase.from('projects').select(selectFieldsFallback)
                    .eq('is_public', true).eq('status', 'ready')
                    .order('play_count', { ascending: false }).limit(200),
            ]);
        }

        if (newestResult.error) throw newestResult.error;
        if (popularResult.error) throw popularResult.error;

        // Filter out test/junk projects from public browse
        const isRealProject = (p) => {
            const name = (p.creator_name || '').toLowerCase();
            const title = (p.title || '').toLowerCase();
            if (name === 'anonymous' || name === 'test user') return false;
            if (p.creator_id?.startsWith('test-')) return false;
            if (/^test\b/i.test(title) && title.length < 30) return false;
            if (title === 'prefix-test' || title === 'test') return false;
            return true;
        };
        browseCache.newest = (newestResult.data || []).filter(isRealProject);
        browseCache.popular = (popularResult.data || []).filter(isRealProject);
        browseCache.totalCount = browseCache.newest.length;
        browseCache.lastRefreshed = Date.now();

        console.log(`[cache] Browse cache refreshed: ${browseCache.totalCount} projects`);
    } catch (error) {
        console.error('[cache] Refresh error:', error.message);
    } finally {
        browseCache.isRefreshing = false;
    }
}

// Initial cache load + periodic refresh
refreshBrowseCache();
setInterval(refreshBrowseCache, CACHE_REFRESH_INTERVAL);

// ============================================
// Suggestions Cache — DB-backed, in-memory cache of project ideas
// Populated from project_suggestions table. Refreshed periodically.
// ============================================
let suggestionsCache = {
    items: [],         // all active suggestions [{label, prompt}]
    lastRefreshed: 0,
    isRefreshing: false,
};

async function refreshSuggestionsCache() {
    if (suggestionsCache.isRefreshing) return;
    suggestionsCache.isRefreshing = true;
    try {
        const { data, error } = await supabase
            .from('project_suggestions')
            .select('label, prompt')
            .eq('status', 'active')
            .order('created_at', { ascending: false });

        if (error) throw error;

        suggestionsCache.items = data || [];
        suggestionsCache.lastRefreshed = Date.now();
        console.log(`[suggestions-cache] Refreshed: ${suggestionsCache.items.length} active suggestions`);
    } catch (error) {
        console.error('[suggestions-cache] Refresh error:', error.message);
    } finally {
        suggestionsCache.isRefreshing = false;
    }
}

const BUILT_IN_SUGGESTIONS = [
    { label: 'Portfolio Site', prompt: 'Build a personal portfolio website with a dark theme, animated hero section, project gallery with hover effects, skills section, and a working contact form' },
    { label: 'Task Manager', prompt: 'Build a Kanban-style task manager with drag and drop columns (To Do, In Progress, Done), ability to add/edit/delete tasks, priority labels, and local storage persistence' },
    { label: 'E-Commerce Store', prompt: 'Build a modern e-commerce product page with image gallery, size selector, add to cart button, customer reviews section, and a responsive mobile layout' },
    { label: 'Analytics Dashboard', prompt: 'Build an analytics dashboard with sidebar navigation, chart cards showing revenue/users/orders metrics, a data table with sorting, and a dark professional theme' },
    { label: 'Restaurant Menu', prompt: 'Build a restaurant website with a hero image, interactive menu with categories and filtering, reservation form, photo gallery, and Google Maps embed placeholder' },
    { label: 'Quiz Game', prompt: 'Build an interactive quiz game with multiple choice questions, score tracking, timer, progress bar, results screen with share button, and colorful animations' },
    { label: 'Recipe Finder', prompt: 'Build a recipe search app with ingredient-based filtering, step-by-step cooking instructions, save favorites, and a warm kitchen-themed design' },
    { label: 'Weather Dashboard', prompt: 'Build a weather app that shows current conditions and 5-day forecast using geolocation, with temperature, humidity, wind speed, weather icons, and a clean card layout' },
    { label: 'Habit Tracker', prompt: 'Build a habit tracking app where each habit grows a virtual plant based on consistency, with streak counters, weekly progress charts, and a garden aesthetic' },
    { label: 'Mood Journal', prompt: 'Build a mood tracking journal where users log daily emotions with color-coded entries, write reflections, view mood trends over time, and export their history' },
    { label: 'Pomodoro Timer', prompt: 'Build a Pomodoro productivity timer with customizable work/break intervals, session counter, task list integration, ambient sounds, and a minimal focused design' },
    { label: 'Budget Planner', prompt: 'Build a personal budget planner with income and expense tracking, category breakdowns with pie charts, monthly summaries, savings goals, and a clean modern UI' },
    { label: 'Flashcard App', prompt: 'Build a spaced repetition flashcard app with deck creation, flip animations, difficulty rating, progress tracking, and a study streak counter' },
    { label: 'Music Player', prompt: 'Build a music player UI with album art display, playback controls, playlist management, equalizer visualization, and a sleek dark gradient theme' },
    { label: 'Travel Planner', prompt: 'Build a trip planning app with destination search, itinerary builder with drag-and-drop days, packing checklist, budget tracker, and a map-themed design' },
    { label: 'Fitness Logger', prompt: 'Build a workout tracker with exercise library, set/rep logging, progress charts, personal records, rest timer, and an energetic sports-themed design' },
    { label: 'Landing Page', prompt: 'Build a SaaS landing page with animated hero, feature cards, pricing table, testimonial carousel, FAQ accordion, and a call-to-action with email signup' },
    { label: 'Chat Interface', prompt: 'Build a real-time chat interface with message bubbles, typing indicators, emoji picker, file attachment previews, and a clean WhatsApp-inspired design' },
    { label: 'Notes App', prompt: 'Build a markdown notes app with sidebar navigation, rich text editing, tag-based organization, search functionality, and a Notion-inspired minimal design' },
    { label: 'Photo Gallery', prompt: 'Build a photo gallery with masonry grid layout, lightbox viewer, album organization, drag-and-drop upload, and smooth transition animations' },
    { label: 'Booking System', prompt: 'Build a service booking app with calendar date picker, time slot selection, service menu, booking confirmation, and a professional clean design' },
    { label: 'Social Feed', prompt: 'Build a social media feed with post cards, like/comment interactions, user avatars, infinite scroll, stories bar at top, and a modern Instagram-inspired layout' },
    { label: 'Code Playground', prompt: 'Build a live code editor with HTML/CSS/JS tabs, real-time preview panel, syntax highlighting, code sharing, and a VS Code-inspired dark theme' },
    { label: 'Movie Browser', prompt: 'Build a movie discovery app with trending carousel, genre filtering, movie detail cards with ratings, watchlist feature, and a Netflix-inspired dark theme' },
    { label: 'Resume Builder', prompt: 'Build a resume builder with form sections for experience, education, and skills, live preview, multiple template choices, and PDF-style export view' },
    { label: 'Countdown Timer', prompt: 'Build an event countdown app with multiple countdowns, custom background images per event, share functionality, and animated flip-clock style numbers' },
    { label: 'Drawing Canvas', prompt: 'Build a drawing app with brush tools, color picker, undo/redo, layer support, canvas resize, and the ability to save artwork as PNG' },
    { label: 'Crypto Tracker', prompt: 'Build a cryptocurrency dashboard with live price cards, sparkline charts, portfolio tracker, watchlist, price alerts setup, and a futuristic dark theme' },
    { label: 'Survey Builder', prompt: 'Build a form/survey builder with drag-and-drop question types, preview mode, response summary, and a clean Typeform-inspired design' },
    { label: 'Podcast Player', prompt: 'Build a podcast player with episode list, playback speed controls, chapter markers, queue management, and a minimal audio-focused design' },
    { label: 'Grocery List', prompt: 'Build a smart grocery list app with category grouping, quantity adjusters, check-off items, frequently bought suggestions, and a fresh produce-themed design' },
    { label: 'Color Palette', prompt: 'Build a color palette generator with random palette creation, color harmony rules, copy hex codes, save palettes, and smooth gradient previews' },
    { label: 'Blog Platform', prompt: 'Build a blog with article list, reading time estimates, tag filtering, dark/light mode toggle, and a clean Medium-inspired typography-focused design' },
    { label: 'Meditation App', prompt: 'Build a meditation timer with guided breathing animation, ambient nature sounds, session history, streak tracking, and a calming zen-inspired design' },
    { label: 'Typing Speed', prompt: 'Build a typing speed test with random text passages, live WPM counter, accuracy tracking, high score board, and a retro terminal-style design' },
    { label: 'Event Board', prompt: 'Build a community event board with event cards, date filtering, category tags, RSVP buttons, map location previews, and a vibrant poster-style design' },
    { label: 'Invoice Maker', prompt: 'Build an invoice generator with client details form, line item table, tax calculations, PDF preview, and a professional business-themed design' },
    { label: 'Reading List', prompt: 'Build a book tracking app with reading status, star ratings, notes per book, reading stats, and a warm library-themed design' },
    { label: 'Password Gen', prompt: 'Build a password generator with length slider, character type toggles, strength meter, copy button, password history, and a security-themed dark design' },
    { label: 'Pet Dashboard', prompt: 'Build a pet care tracker with feeding schedules, vet appointment calendar, medication reminders, photo gallery per pet, and a playful paw-print themed design' },
    { label: 'Kanban Board', prompt: 'Build a project management board with customizable columns, task cards with labels and due dates, drag and drop, member avatars, and a Trello-inspired design' },
    { label: 'Language Cards', prompt: 'Build a language learning flashcard app with vocabulary decks, pronunciation guide, spaced repetition, daily goals, and a colorful educational design' },
    { label: 'Meal Planner', prompt: 'Build a weekly meal planning app with drag-and-drop recipe slots, auto-generated grocery lists, nutritional summaries, and a fresh food-photography inspired design' },
    { label: 'Pixel Art Editor', prompt: 'Build a pixel art editor with grid canvas, color palette, brush and fill tools, animation frames, export as sprite sheet, and a retro 8-bit themed interface' },
    { label: 'Expense Splitter', prompt: 'Build a bill splitting app for groups with itemized expenses, equal or custom splits, running balances, settle up tracking, and a friendly social design' },
    { label: 'Mood Playlist', prompt: 'Build a mood-based playlist maker where users pick emotions from a wheel, get song suggestions with album art, create shareable playlists, and a Spotify-inspired dark UI' },
    { label: 'Daily Standup', prompt: 'Build a daily standup tracker where team members log yesterday, today, and blockers, with history view, team overview, and a clean Slack-inspired design' },
    { label: 'Emoji Kitchen', prompt: 'Build a fun emoji mixer app where users combine two emojis to create mashup designs, browse combinations, share results, and a playful colorful interface' },
    { label: 'Plant Identifier', prompt: 'Build a plant care app with a plant library, watering schedule reminders, growth photo journal, care tips, and a lush botanical green-themed design' },
    { label: 'Debate Timer', prompt: 'Build a debate/speech timer with configurable rounds, speaker tracking, bell sounds, score cards, and a professional podium-themed dark design' },
];

function getRandomSuggestions(count = 6) {
    const pool = suggestionsCache.items.length > 0 ? suggestionsCache.items : BUILT_IN_SUGGESTIONS;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, pool.length));
}

// Initial load + periodic refresh
refreshSuggestionsCache();
setInterval(refreshSuggestionsCache, SUGGESTIONS_CACHE_REFRESH_INTERVAL);

// ============================================
// Suggestion Lifecycle — mark used after generation
// ============================================
async function markSuggestionAsUsed(prompt) {
    try {
        const { data, error } = await supabase
            .from('project_suggestions')
            .update({ status: 'used', used_at: new Date().toISOString() })
            .eq('status', 'active')
            .eq('prompt', prompt)
            .select('id, label');

        if (error) {
            console.error('[suggestions] Error marking used:', error.message);
            return null;
        }

        if (data && data.length > 0) {
            console.log(`[suggestions] Marked as used: "${data[0].label}"`);
            return data[0];
        }

        return null; // user-typed prompt, no matching suggestion
    } catch (error) {
        console.error('[suggestions] markSuggestionAsUsed error:', error.message);
        return null;
    }
}

// ============================================
// Helper: SSE proxy from worker to client
// Reads a ReadableStream from the worker, parses SSE events,
// and forwards them to the Express response.
// ============================================
async function proxyWorkerSSE(workerResponse, res, {
    onResult = null,
    onError = null,
    label = 'proxy'
} = {}) {
    if (!workerResponse.body) {
        try { res.write(`data: ${JSON.stringify({ type: 'error', error: 'Build server connection failed' })}\n\n`); res.end(); } catch {}
        return false;
    }

    const reader = workerResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let resultReceived = false;
    let clientConnected = true;
    res.on('close', () => { clientConnected = false; });

    const safeWrite = (data) => {
        if (!clientConnected) return;
        try { res.write(data); } catch { clientConnected = false; }
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events from the buffer
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                // Forward SSE comments (keepalives) from worker to client
                if (line.startsWith(':')) {
                    safeWrite(line + '\n\n');
                    continue;
                }
                if (line.startsWith('data: ')) {
                    const eventData = line.substring(6);
                    try {
                        const parsed = JSON.parse(eventData);

                        if (parsed.type === 'status') {
                            safeWrite(`data: ${JSON.stringify({
                                type: 'status',
                                phase: parsed.phase,
                                message: parsed.message,
                                detail: parsed.detail,
                                progressPercent: parsed.progressPercent,
                                progressEndPct: parsed.progressEndPct,
                                phaseDurationSeconds: parsed.phaseDurationSeconds,
                                estimatedSecondsRemaining: parsed.estimatedSecondsRemaining
                            })}\n\n`);
                        } else if (parsed.type === 'result') {
                            resultReceived = true;
                            if (onResult) {
                                // Always call onResult to save to DB, even if client disconnected
                                await onResult(parsed, res);
                            } else {
                                safeWrite(`data: ${JSON.stringify(parsed)}\n\n`);
                            }
                        } else if (parsed.type === 'error') {
                            if (onError) {
                                await onError(parsed, res);
                            } else {
                                safeWrite(`data: ${JSON.stringify({ type: 'error', error: parsed.error })}\n\n`);
                            }
                        }
                    } catch {
                        // Malformed event, skip
                    }
                }
            }
        }
    } catch (streamError) {
        console.error(`[${label}] Stream error:`, streamError.message);
        if (!resultReceived) {
            safeWrite(`data: ${JSON.stringify({ type: 'error', error: 'Connection to build server lost' })}\n\n`);
        }
    }

    return resultReceived;
}

// ============================================
// Helper: Set up SSE response headers + heartbeat
// ============================================
function setupSSE(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeatInterval = setInterval(() => {
        try { res.write(':heartbeat\n\n'); } catch {}
    }, 15000);
    res.on('close', () => clearInterval(heartbeatInterval));
}

// ============================================
// POST /api/projects/generate
// Streaming endpoint — proxies SSE status events from the worker to the client
// ============================================
router.post('/generate', async (req, res) => {
    try {
        const { prompt, userId, userName, framework, referenceImage, deviceToken } = req.body;

        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            return res.status(400).json({ error: 'Project description is required' });
        }

        if (prompt.length > 2000) {
            return res.status(400).json({ error: 'Description must be under 2000 characters' });
        }

        // Block code injection and malicious prompts
        const lowerPrompt = prompt.toLowerCase();
        const codePatterns = [
            'import os', 'import subprocess', 'import asyncio', 'import sys',
            'require(', 'eval(', 'exec(', 'system(',
            'subprocess.', 'os.system', 'os.popen',
            'child_process', 'puppeteer', 'selenium',
            'websocket.server', 'websockets.connect',
            '#!/', 'bash -c',
            'rm -rf', 'chmod ', 'chown ',
            'def __', 'if __name__',
            'document.cookie', 'window.location.href='
        ];
        if (codePatterns.some(p => lowerPrompt.includes(p))) {
            console.warn(`[generate] BLOCKED malicious prompt from ${userId}: "${prompt.substring(0, 100)}"`);
            return res.status(400).json({ error: 'Please describe your app idea in plain language instead of pasting code.' });
        }

        // Block prompts with URLs
        if (/https?:\/\/\S+/i.test(prompt)) {
            console.warn(`[generate] BLOCKED URL prompt from ${userId}: "${prompt.substring(0, 100)}"`);
            return res.status(400).json({ error: 'Please describe your app idea in your own words instead of pasting URLs.' });
        }

        if (!checkRateLimit(userId)) {
            return res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' });
        }

        // Subscription usage check disabled until tables are created
        // TODO: Re-enable when user_subscriptions and subscription_usage tables exist

        console.log(`[generate] User ${userId}: "${prompt.substring(0, 80)}"${referenceImage ? ' (with reference image)' : ''}`);

        // Create placeholder project in "building" state so it shows in My Projects immediately
        let placeholderProjectId = null;
        try {
            let title = prompt.trim()
                .replace(/^(build|create|make|design|develop)\s+(a|an|the|me\s+a|me\s+an)?\s*/i, '')
                .replace(/\s+(with|that|where|which|for|using|featuring|including|and\s+a)\s+.*/i, '')
                .split(/\s+/).slice(0, 5).join(' ')
                .substring(0, 50) || 'My App';
            title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

            const { data: placeholder, error: phErr } = await supabase
                .from('projects')
                .insert({
                    title,
                    description: prompt,
                    creator_id: userId,
                    creator_name: userName || 'VibeBuild User',
                    initial_prompt: prompt,
                    is_public: true,
                    project_type: 'web_app',
                    creation_method: 'ai_generated',
                    status: 'building'
                })
                .select('id')
                .single();

            if (!phErr && placeholder) {
                placeholderProjectId = placeholder.id;
                console.log(`[generate] Placeholder project created: ${placeholderProjectId}`);
            }
        } catch (e) {
            console.error(`[generate] Placeholder creation failed: ${e.message}`);
        }

        // Set up SSE
        setupSSE(res);

        // Send projectId immediately so client can poll if connection drops
        if (placeholderProjectId) {
            res.write(`data: ${JSON.stringify({ type: 'queued', projectId: placeholderProjectId })}\n\n`);
        }

        // Use async callback path — close SSE after queued event, app polls for result
        // Old app versions (stream:true) still get the SSE proxy path for compatibility
        const clientWantsStream = req.body.stream === true;
        const callbackUrl = `${process.env.SELF_URL || 'https://vibecoder-api-917362189743.us-central1.run.app'}/api/projects/${placeholderProjectId}/build-complete`;
        const workerBody = {
            prompt: prompt.trim(),
            userId,
            framework: framework || 'react',
            stream: clientWantsStream,
            projectId: placeholderProjectId,
            ...(!clientWantsStream && { callbackUrl, callbackSecret: WORKER_SECRET })
        };
        if (referenceImage && typeof referenceImage === 'string') {
            workerBody.referenceImage = referenceImage;
        }

        const workerResponse = await fetch(`${WORKER_URL}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-worker-secret': WORKER_SECRET },
            body: JSON.stringify(workerBody),
            signal: AbortSignal.timeout(clientWantsStream ? 600000 : 30000)
        });

        if (!workerResponse.ok) {
            let errorMsg = `Build server error (${workerResponse.status})`;
            let systemBusy = false;
            try {
                if (workerResponse.headers.get('content-type')?.includes('application/json')) {
                    const err = await workerResponse.json();
                    errorMsg = err.error || errorMsg;
                    if (err.quotaExhausted) {
                        res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg, quotaExhausted: true, resetTime: err.resetTime })}\n\n`);
                        res.end();
                        if (placeholderProjectId) supabase.from('projects').update({ status: 'failed' }).eq('id', placeholderProjectId).then(() => {});
                        return;
                    }
                    if (workerResponse.status === 429) {
                        systemBusy = true;
                        errorMsg = 'Our builders are at full capacity right now. Pro users get priority access — upgrade to skip the queue.';
                    }
                }
            } catch {}
            if (placeholderProjectId && !systemBusy) {
                supabase.from('projects').update({ status: 'failed' }).eq('id', placeholderProjectId).then(() => {});
                const shortPrompt = prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt;
                if (userId) sendPushToUser(userId, 'Builders are overloaded 🔥', `"${shortPrompt}..." is queued. Pro users skip the line — upgrade for priority builds.`).catch(() => {});
            }
            safeWrite(`data: ${JSON.stringify({ type: 'error', error: errorMsg, systemBusy, projectId: placeholderProjectId })}\n\n`);
            try { res.end(); } catch {}
            return;
        }

        // Async callback path (new app, stream:false) — close SSE now, app polls
        if (!clientWantsStream) {
            console.log(`[generate] Dispatched async build for ${placeholderProjectId}, closing SSE`);
            recordGeneration(userId);
            if (userId) recordUsage(userId, ACTION_TYPES.generation).catch(() => {});
            try { res.end(); } catch {}
            return;
        }

        // SSE proxy path (old app, stream:true) — keep connection open, proxy worker events
        const resultReceived = await proxyWorkerSSE(workerResponse, res, {
            label: 'generate',
            onResult: async (parsed, res) => {
                recordGeneration(userId);

                // Record usage for subscription tracking
                if (userId) {
                    await recordUsage(userId, ACTION_TYPES.generation);
                }

                const generationId = `gen-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

                console.log(`[generate] Complete: ${generationId} (${parsed.files?.length} files, ${((parsed.bundleSize || 0) / 1024).toFixed(1)}KB, ${parsed.generationTime}s)`);

                // Update placeholder project with bundle and deploy preview
                let savedProjectId = placeholderProjectId;
                try {
                    if (savedProjectId) {
                        // Update existing placeholder with bundle and mark as ready
                        await supabase.from('projects').update({
                            bundle: parsed.bundle,
                            status: 'ready'
                        }).eq('id', savedProjectId);
                        console.log(`[generate] Updated project ${savedProjectId} with bundle`);
                    } else {
                        // Fallback: create new project if placeholder wasn't created
                        let title = prompt.trim()
                            .replace(/^(build|create|make|design|develop)\s+(a|an|the|me\s+a|me\s+an)?\s*/i, '')
                            .replace(/\s+(with|that|where|which|for|using|featuring|including|and\s+a)\s+.*/i, '')
                            .split(/\s+/).slice(0, 5).join(' ')
                            .substring(0, 50) || 'My App';
                        title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                        const { data: saved, error: saveErr } = await supabase
                            .from('projects')
                            .insert({
                                title, description: prompt, bundle: parsed.bundle,
                                creator_id: userId, creator_name: userName || 'VibeBuild User',
                                initial_prompt: prompt, is_public: true,
                                project_type: 'web_app', creation_method: 'ai_generated', status: 'ready'
                            })
                            .select('id').single();
                        if (!saveErr && saved) savedProjectId = saved.id;
                    }

                    if (savedProjectId) {
                        console.log(`[generate] Project ready: ${savedProjectId}`);

                        // Auto-deploy preview (so URL-based preview works)
                        try {
                            const previewSubdomain = `preview-${savedProjectId.substring(0, 12)}`;
                            const deployRes = await fetch(`${DEPLOY_SERVER_URL}/deploy`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ subdomain: previewSubdomain, bundle: parsed.bundle })
                            });
                            if (deployRes.ok) {
                                const previewUrl = `https://${previewSubdomain}.vibecoder.app`;
                                await supabase.from('projects').update({ preview_url: previewUrl }).eq('id', savedProjectId);
                                console.log(`[generate] Preview deployed: ${previewUrl}`);

                                // Auto-capture thumbnail in background
                                const screenshotServiceUrl = process.env.SCREENSHOT_SERVICE_URL || 'http://178.156.231.255:3465';
                                fetch(`${screenshotServiceUrl}/screenshot?url=${encodeURIComponent(previewUrl)}&width=390&height=844`)
                                    .then(async (sr) => {
                                        if (sr.ok) {
                                            const imgBuffer = await sr.arrayBuffer();
                                            // Upload to Supabase Storage
                                            const fileName = `thumbnails/${savedProjectId}.jpg`;
                                            const { error: uploadErr } = await supabase.storage
                                                .from('project-assets')
                                                .upload(fileName, Buffer.from(imgBuffer), {
                                                    contentType: 'image/jpeg',
                                                    upsert: true
                                                });
                                            if (!uploadErr) {
                                                const { data: { publicUrl } } = supabase.storage
                                                    .from('project-assets')
                                                    .getPublicUrl(fileName);
                                                await supabase.from('projects').update({ thumbnail_url: publicUrl }).eq('id', savedProjectId);
                                                console.log(`[generate] Thumbnail captured: ${publicUrl}`);
                                            } else {
                                                // Fallback: store screenshot service URL directly
                                                const thumbnailUrl = `${screenshotServiceUrl}/screenshot?url=${encodeURIComponent(previewUrl)}&width=390&height=844`;
                                                await supabase.from('projects').update({ thumbnail_url: thumbnailUrl }).eq('id', savedProjectId);
                                                console.log(`[generate] Thumbnail URL stored (direct): ${thumbnailUrl}`);
                                            }
                                        }
                                    })
                                    .catch(e => console.error(`[generate] Thumbnail capture failed: ${e.message}`));
                            }
                        } catch (e) {
                            console.error(`[generate] Preview deploy failed: ${e.message}`);
                        }

                        // Init git repo in background (updates github_repo on project)
                        fetch(`${WORKER_URL}/init-repo`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-worker-secret': WORKER_SECRET },
                            body: JSON.stringify({ projectId: savedProjectId, bundle: parsed.bundle })
                        }).then(async (r) => {
                            if (r.ok) {
                                const result = await r.json();
                                if (result.repoName) {
                                    await supabase.from('projects').update({ github_repo: result.repoName }).eq('id', savedProjectId);
                                    console.log(`[generate] Git repo linked: ${result.repoName}`);
                                }
                            }
                        }).catch((e) => {
                            console.error(`[generate] Init repo failed: ${e.message}`);
                        });
                    }
                } catch (e) {
                    console.error(`[generate] Auto-save failed: ${e.message}`);
                }

                // Get preview URL from saved project
                let previewUrl = null;
                if (savedProjectId) {
                    const { data: proj } = await supabase.from('projects').select('preview_url').eq('id', savedProjectId).single();
                    previewUrl = proj?.preview_url;
                }

                res.write(`data: ${JSON.stringify({
                    type: 'result',
                    success: true,
                    generationId,
                    projectId: savedProjectId,
                    previewUrl,
                    bundle: parsed.bundle,
                    bundleSize: parsed.bundleSize,
                    files: parsed.files,
                    generationTime: parsed.generationTime,
                    quality: parsed.quality
                })}\n\n`);

                // Send push notification to user (iOS + Android)
                const shortPrompt = prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt;
                if (userId) {
                    sendPushToUser(userId, 'Project Ready!', `"${shortPrompt}" has been built. Tap to view!`).catch(() => {});
                } else if (deviceToken) {
                    sendAPNsPush(deviceToken, 'Project Ready!', `"${shortPrompt}" has been built. Tap to view!`).catch(() => {});
                }
            }
        });

        // If stream ended without a result, mark placeholder failed
        if (!resultReceived && placeholderProjectId) {
            supabase.from('projects').update({ status: 'failed' }).eq('id', placeholderProjectId).then(() => {
                console.log(`[generate] Marked ${placeholderProjectId} as failed (no result received)`);
            });
            const shortPrompt = prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt;
            if (userId) sendPushToUser(userId, 'Builders are overloaded 🔥', `"${shortPrompt}..." hit a snag. Pro users get priority — upgrade to skip the queue.`).catch(() => {});
        }
        try { res.end(); } catch {}

    } catch (error) {
        console.error('[generate] Error:', error.message);

        // Mark placeholder failed on exception
        if (placeholderProjectId) {
            supabase.from('projects').update({ status: 'failed' }).eq('id', placeholderProjectId).then(() => {});
            const shortPrompt = prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt;
            if (userId) sendPushToUser(userId, 'Builders are overloaded 🔥', `"${shortPrompt}..." hit a snag. Pro users get priority — upgrade to skip the queue.`).catch(() => {});
        }

        if (res.headersSent) {
            try { res.write(`data: ${JSON.stringify({ type: 'error', error: 'Server error. Please try again.' })}\n\n`); res.end(); } catch {}
        } else {
            if (error.name === 'TimeoutError') {
                return res.status(504).json({ error: 'Project generation timed out. Try a simpler idea.' });
            }
            res.status(500).json({ error: 'Failed to generate project. Please try again.' });
        }
    }
});

// ============================================
// POST /api/projects/save
// Stores the project bundle in the DB
// ============================================
router.post('/save', async (req, res) => {
    try {
        const { title, description, bundle, creatorId, creatorName, initialPrompt, framework, isPublic } = req.body;

        if (!title || !bundle || !creatorId) {
            return res.status(400).json({ error: 'title, bundle, and creatorId are required' });
        }

        // Truncate title to fit DB varchar constraint
        const safeTitle = title.length > 180 ? title.substring(0, 180).trim() + '...' : title;

        // If user wants to create a private project, check subscription
        if (isPublic === false) {
            const limitCheck = await checkUsageLimit(creatorId, ACTION_TYPES.createPrivate);
            if (!limitCheck.allowed) {
                console.log(`[save] Private project not allowed: ${limitCheck.error}`);
                return res.status(403).json({
                    error: limitCheck.error,
                    requiresTier: limitCheck.requiresTier,
                    currentTier: limitCheck.currentTier
                });
            }
        }

        const projectId = crypto.randomUUID();
        const bundleSizeKB = (Buffer.from(bundle, 'base64').length / 1024).toFixed(1);

        // Push to GitHub (primary storage - no bundle in DB)
        let githubRepo = null;
        try {
            const initResponse = await fetch(`${WORKER_URL}/init-repo`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-worker-secret': WORKER_SECRET
                },
                body: JSON.stringify({ projectId, bundle }),
                signal: AbortSignal.timeout(120000)
            });
            if (initResponse.ok) {
                const initResult = await initResponse.json();
                githubRepo = initResult.repoName;
                console.log(`[save] GitHub repo created: ${githubRepo}`);
            } else {
                const errText = await initResponse.text();
                console.error(`[save] GitHub init failed (${initResponse.status}): ${errText}`);
            }
        } catch (gitErr) {
            console.error(`[save] GitHub init error: ${gitErr.message}`);
        }

        // Ensure user exists
        await supabase
            .from('users')
            .upsert({
                user_id: creatorId,
                display_name: creatorName || 'Anonymous',
                subscription_tier: 'free'
            }, { onConflict: 'user_id', ignoreDuplicates: true });

        const { data, error: dbError } = await supabase
            .from('projects')
            .insert({
                id: projectId,
                title: safeTitle,
                description: description || initialPrompt || `AI-generated project: ${safeTitle}`,
                // No bundle stored in DB - code lives in GitHub
                creator_id: creatorId,
                creator_name: creatorName || 'Anonymous',
                project_type: 'web_app',
                initial_prompt: initialPrompt || null,
                github_repo: githubRepo,
                is_public: isPublic !== false,
                play_count: 0,
                fork_count: 0,
                free_tweaks_remaining: FREE_TWEAKS_DEFAULT
            })
            .select()
            .single();

        if (dbError) throw dbError;

        console.log(`[save] Project saved: ${projectId} "${safeTitle}" (${bundleSizeKB}KB) repo=${githubRepo}`);

        refreshBrowseCache();

        if (initialPrompt) {
            markSuggestionAsUsed(initialPrompt).catch(err =>
                console.error('[suggestions] Background task error:', err.message)
            );
        }

        res.json({
            success: true,
            projectId,
            githubRepo
        });

    } catch (error) {
        console.error('[save] Error:', error.message);
        res.status(500).json({ error: 'Failed to save project' });
    }
});

// ============================================
// GET /api/projects/browse
// Served from in-memory cache — fast, no DB hit per request.
// Supports pagination: ?limit=20&offset=0&sort=newest|popular
// ============================================
router.get('/browse', (req, res) => {
    try {
        const { limit = 20, offset = 0, sort = 'newest', search } = req.query;
        const parsedLimit = Math.min(parseInt(limit) || 20, 50);
        const parsedOffset = parseInt(offset) || 0;

        let source = sort === 'popular' ? browseCache.popular : browseCache.newest;

        // Optional search filter on cached data
        if (search && search.trim().length > 0) {
            const query = search.trim().toLowerCase();
            source = source.filter(p =>
                (p.title && p.title.toLowerCase().includes(query)) ||
                (p.description && p.description.toLowerCase().includes(query)) ||
                (p.project_type && p.project_type.toLowerCase().includes(query))
            );
        }

        const page = source.slice(parsedOffset, parsedOffset + parsedLimit);
        const totalCount = source.length;

        res.json({
            success: true,
            projects: page,
            totalCount,
            hasMore: (parsedOffset + parsedLimit) < totalCount
        });
    } catch (error) {
        console.error('[browse] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// ============================================
// POST /api/projects/:id/feedback
// Record thumbs up/down feedback for a generated project
// ============================================
// POST /api/projects/:id/retry
// Re-dispatches a failed build without creating a new project
router.post('/:id/retry', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const { data: project, error: fetchErr } = await supabase
            .from('projects')
            .select('id, initial_prompt, status, creator_id')
            .eq('id', id)
            .single();

        if (fetchErr || !project) return res.status(404).json({ error: 'Project not found' });
        if (project.creator_id !== userId) return res.status(403).json({ error: 'Forbidden' });
        if (project.status !== 'failed') return res.status(400).json({ error: 'Project is not in failed state' });
        if (!project.initial_prompt) return res.status(400).json({ error: 'No prompt to retry' });

        // Reset to building
        await supabase.from('projects').update({ status: 'building' }).eq('id', id);

        // Fire-and-forget dispatch to worker — worker result updates this same project
        res.json({ success: true, projectId: id });

        // Dispatch to worker with callback URL — worker POSTs result back when done
        // This avoids Cloud Run killing the long-running SSE stream after response is sent
        const callbackUrl = `${process.env.SELF_URL || 'https://vibecoder-api-917362189743.us-central1.run.app'}/api/projects/${id}/build-complete`;
        const workerBody = { prompt: project.initial_prompt, userId, framework: 'react', stream: false, projectId: id, callbackUrl, callbackSecret: WORKER_SECRET };
        console.log(`[retry] Dispatching to worker for ${id}`);
        fetch(`${WORKER_URL}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-worker-secret': WORKER_SECRET },
            body: JSON.stringify(workerBody),
            signal: AbortSignal.timeout(30000)
        }).then(async (workerRes) => {
            console.log(`[retry] Worker accepted: ${workerRes.status} for ${id}`);
            if (!workerRes.ok) {
                const errText = await workerRes.text().catch(() => '');
                if (workerRes.status === 429) {
                    console.log(`[retry] Worker busy for ${id} — build stays in building state, will poll`);
                    // Leave as building — cleanup cron will reset if it gets stuck
                    return;
                }
                console.error(`[retry] Worker error ${workerRes.status}: ${errText.substring(0, 200)}`);
                await supabase.from('projects').update({ status: 'failed' }).eq('id', id);
            }
        }).catch(async (err) => {
            console.error(`[retry] Worker fetch error: ${err.message}`);
            await supabase.from('projects').update({ status: 'failed' }).eq('id', id);
        });

    } catch (error) {
        console.error('[retry] Error:', error.message);
        res.status(500).json({ error: 'Failed to retry project' });
    }
});

router.post('/:id/feedback', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, rating } = req.body; // rating: 'up' | 'down'
        if (!userId || !['up', 'down'].includes(rating)) {
            return res.status(400).json({ error: 'userId and rating (up/down) required' });
        }

        const { error } = await supabase
            .from('project_feedback')
            .upsert({
                project_id: id,
                user_id: userId,
                rating,
                created_at: new Date().toISOString(),
            }, { onConflict: 'project_id,user_id' });

        if (error) throw error;
        console.log(`[feedback] Project ${id}: ${rating} by ${userId}`);
        res.json({ success: true });
    } catch (error) {
        console.error('[feedback] Error:', error.message);
        res.status(500).json({ error: 'Failed to save feedback' });
    }
});

// ============================================
// POST /api/projects/:id/build-complete
// Callback from worker when a retry build finishes
// ============================================
router.post('/:id/build-complete', async (req, res) => {
    try {
        const { id } = req.params;
        const { bundle, status, error, userId, secret } = req.body;

        if (secret !== WORKER_SECRET) return res.status(401).json({ error: 'Unauthorized' });
        if (!id) return res.status(400).json({ error: 'Missing id' });

        if (bundle && status === 'ready') {
            await supabase.from('projects').update({ bundle, status: 'ready' }).eq('id', id);
            console.log(`[build-complete] Project ${id} ready`);

            // Auto-deploy preview + capture thumbnail
            try {
                const previewSubdomain = `prev-${id.substring(0, 8)}`;
                const previewServiceUrl = process.env.PREVIEW_SERVICE_URL || 'http://178.156.231.255:3456';
                const deployRes = await fetch(`${previewServiceUrl}/deploy-preview`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subdomain: previewSubdomain, bundle })
                });
                if (deployRes.ok) {
                    const previewUrl = `https://${previewSubdomain}.vibecoder.app`;
                    await supabase.from('projects').update({ preview_url: previewUrl }).eq('id', id);
                    // Capture thumbnail in background
                    const screenshotServiceUrl = process.env.SCREENSHOT_SERVICE_URL || 'http://178.156.231.255:3465';
                    fetch(`${screenshotServiceUrl}/screenshot?url=${encodeURIComponent(previewUrl)}&width=390&height=844`)
                        .then(async (sr) => {
                            if (!sr.ok) return;
                            const imgBuffer = await sr.arrayBuffer();
                            const fileName = `thumbnails/${id}.jpg`;
                            const { error: uploadErr } = await supabase.storage
                                .from('project-assets')
                                .upload(fileName, Buffer.from(imgBuffer), { contentType: 'image/jpeg', upsert: true });
                            if (!uploadErr) {
                                const { data: { publicUrl } } = supabase.storage.from('project-assets').getPublicUrl(fileName);
                                await supabase.from('projects').update({ thumbnail_url: publicUrl }).eq('id', id);
                                console.log(`[build-complete] Thumbnail captured: ${publicUrl}`);
                            } else {
                                const thumbnailUrl = `${screenshotServiceUrl}/screenshot?url=${encodeURIComponent(previewUrl)}&width=390&height=844`;
                                await supabase.from('projects').update({ thumbnail_url: thumbnailUrl }).eq('id', id);
                            }
                        })
                        .catch(e => console.error(`[build-complete] Thumbnail failed: ${e.message}`));
                }
            } catch (e) {
                console.error(`[build-complete] Preview/thumbnail error: ${e.message}`);
            }

            if (userId) {
                const { data: proj } = await supabase.from('projects').select('initial_prompt').eq('id', id).single();
                const shortPrompt = (proj?.initial_prompt || '').substring(0, 40);
                sendPushToUser(userId, `"${shortPrompt}" is ready!`, 'Tap to open your app').catch(() => {});
            }
        } else {
            await supabase.from('projects').update({ status: 'failed' }).eq('id', id);
            console.log(`[build-complete] Project ${id} failed: ${error}`);
            if (userId) sendPushToUser(userId, 'Builders are overloaded 🔥', 'Retry failed. Pro users get priority — upgrade to skip the queue.').catch(() => {});
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[build-complete] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// POST /api/projects/:id/view
// Track a view (deduplicated by IP+projectId, 1hr window)
// ============================================
router.post('/:id/view', async (req, res) => {
    try {
        const { id } = req.params;
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

        if (hasRecentView(ip, id)) {
            return res.json({ success: true, deduplicated: true });
        }

        // Increment view_count
        const { data } = await supabase
            .from('projects')
            .select('view_count')
            .eq('id', id)
            .single();

        if (data) {
            await supabase
                .from('projects')
                .update({ view_count: (data.view_count || 0) + 1 })
                .eq('id', id);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[view] Error:', error.message);
        res.status(500).json({ error: 'Failed to track view' });
    }
});

// ============================================
// POST /api/projects/:id/play
// Track a play (deduplicated by IP+projectId, 1hr window)
// ============================================
router.post('/:id/play', async (req, res) => {
    try {
        const { id } = req.params;
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

        if (hasRecentPlay(ip, id)) {
            return res.json({ success: true, deduplicated: true });
        }

        const { data } = await supabase
            .from('projects')
            .select('play_count')
            .eq('id', id)
            .single();

        if (data) {
            await supabase
                .from('projects')
                .update({ play_count: (data.play_count || 0) + 1 })
                .eq('id', id);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[play] Error:', error.message);
        res.status(500).json({ error: 'Failed to track play' });
    }
});

// ============================================
// POST /api/projects/:id/like
// Like a project (requires userId)
// ============================================
router.post('/:id/like', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        // Check if already liked
        const { data: existing } = await supabase
            .from('project_likes')
            .select('id')
            .eq('project_id', id)
            .eq('user_id', userId)
            .single();

        if (existing) {
            return res.json({ success: true, liked: true, message: 'Already liked' });
        }

        // Insert like
        const { error: insertError } = await supabase
            .from('project_likes')
            .insert({ project_id: id, user_id: userId });

        if (insertError) throw insertError;

        // Increment like_count on projects table
        const { data: project } = await supabase
            .from('projects')
            .select('like_count')
            .eq('id', id)
            .single();

        if (project) {
            await supabase
                .from('projects')
                .update({ like_count: (project.like_count || 0) + 1 })
                .eq('id', id);
        }

        // Get updated count
        const { count } = await supabase
            .from('project_likes')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', id);

        res.json({ success: true, liked: true, likeCount: count || 0 });
    } catch (error) {
        console.error('[like] Error:', error.message);
        res.status(500).json({ error: 'Failed to like project' });
    }
});

// ============================================
// DELETE /api/projects/:id/like
// Unlike a project (requires userId)
// ============================================
router.delete('/:id/like', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const { error: deleteError } = await supabase
            .from('project_likes')
            .delete()
            .eq('project_id', id)
            .eq('user_id', userId);

        if (deleteError) throw deleteError;

        // Decrement like_count on projects table
        const { data: project } = await supabase
            .from('projects')
            .select('like_count')
            .eq('id', id)
            .single();

        if (project && (project.like_count || 0) > 0) {
            await supabase
                .from('projects')
                .update({ like_count: (project.like_count || 0) - 1 })
                .eq('id', id);
        }

        // Get updated count
        const { count } = await supabase
            .from('project_likes')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', id);

        res.json({ success: true, liked: false, likeCount: count || 0 });
    } catch (error) {
        console.error('[unlike] Error:', error.message);
        res.status(500).json({ error: 'Failed to unlike project' });
    }
});

// ============================================
// GET /api/projects/:id/like-status
// Check if current user has liked a project
// ============================================
router.get('/:id/like-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;

        if (!userId) return res.json({ success: true, liked: false, likeCount: 0 });

        const [likeResult, countResult] = await Promise.all([
            supabase
                .from('project_likes')
                .select('id')
                .eq('project_id', id)
                .eq('user_id', userId)
                .single(),
            supabase
                .from('project_likes')
                .select('id', { count: 'exact', head: true })
                .eq('project_id', id),
        ]);

        res.json({
            success: true,
            liked: !!likeResult.data,
            likeCount: countResult.count || 0,
        });
    } catch (error) {
        console.error('[like-status] Error:', error.message);
        res.status(500).json({ error: 'Failed to check like status' });
    }
});

// ============================================
// POST /api/projects/track-play
// Internal endpoint for deploy server to track plays by subdomain
// ============================================
router.post('/track-play', async (req, res) => {
    try {
        const { subdomain, ip } = req.body;
        if (!subdomain) return res.status(400).json({ error: 'subdomain is required' });

        // Find project by subdomain via deployments table
        const { data: deployment } = await supabase
            .from('deployments')
            .select('project_id')
            .eq('subdomain', subdomain)
            .eq('status', 'active')
            .single();

        if (!deployment) return res.json({ success: true, message: 'No active deployment found' });

        const projectId = deployment.project_id;
        const clientIp = ip || 'unknown';

        if (hasRecentPlay(clientIp, projectId)) {
            return res.json({ success: true, deduplicated: true });
        }

        const { data: project } = await supabase
            .from('projects')
            .select('play_count')
            .eq('id', projectId)
            .single();

        if (project) {
            await supabase
                .from('projects')
                .update({ play_count: (project.play_count || 0) + 1 })
                .eq('id', projectId);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[track-play] Error:', error.message);
        res.status(500).json({ error: 'Failed to track play' });
    }
});

// ============================================
// POST /api/projects/suggest-ideas
// Generate fresh app ideas using Claude API
// ============================================
router.post('/suggest-ideas', async (req, res) => {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
        // Fallback to built-in if no API key
        const shuffled = [...BUILT_IN_SUGGESTIONS].sort(() => Math.random() - 0.5);
        return res.json({ success: true, suggestions: shuffled.slice(0, 6) });
    }

    try {
        // Pick 3 random existing suggestions as examples of the format
        const examples = [...BUILT_IN_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 3);
        const examplesText = examples.map(s => `- label: "${s.label}", prompt: "${s.prompt}"`).join('\n');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: `Generate 6 creative, unique app ideas for VibeBuild — a platform where users describe an app and AI builds it as a self-contained web app (HTML/CSS/JS, no backend needed).

Each idea needs a short label (2-3 words) and a detailed prompt (1-2 sentences describing what to build, including specific features and design direction).

Ideas should be diverse — mix utility apps, creative tools, games, dashboards, and fun interactive experiences. Be creative and surprising — avoid generic ideas like "todo list" or "calculator".

Here are examples of the format (DO NOT repeat these):
${examplesText}

Output ONLY a JSON array of 6 objects with "label" and "prompt" keys. No markdown, no explanation.`
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`Anthropic API error: ${response.status}`);
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '';

        // Parse JSON from response
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array in response');

        const suggestions = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(suggestions) || suggestions.length === 0) throw new Error('Empty suggestions');

        // Validate each suggestion has label and prompt
        const valid = suggestions
            .filter(s => s.label && s.prompt)
            .slice(0, 6);

        if (valid.length === 0) throw new Error('No valid suggestions');

        res.json({ success: true, suggestions: valid });
    } catch (error) {
        console.error('[suggest-ideas] LLM generation failed:', error.message);
        // Fallback to built-in
        const shuffled = [...BUILT_IN_SUGGESTIONS].sort(() => Math.random() - 0.5);
        res.json({ success: true, suggestions: shuffled.slice(0, 6) });
    }
});

// ============================================
// GET /api/projects/suggestions
// Returns random project idea prompts from the pre-generated pool.
// No DB hit — served instantly from memory.
// ============================================
router.get('/suggestions', (req, res) => {
    const count = Math.min(parseInt(req.query.count) || 6, 10);
    res.json({
        success: true,
        suggestions: getRandomSuggestions(count)
    });
});

// ============================================
// GET /api/projects/my
// Returns the current user's own projects
// ============================================
router.get('/my', async (req, res) => {
    try {
        const { userId, limit = 50, offset = 0 } = req.query;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const parsedLimit = Math.min(parseInt(limit) || 50, 100);
        const parsedOffset = parseInt(offset) || 0;

        const { data, error, count } = await supabase
            .from('projects')
            .select('id, title, description, creator_id, creator_name, project_type, view_count, play_count, fork_count, like_count, created_at, updated_at, is_public, published_url, preview_url, thumbnail_url, github_repo, status, initial_prompt, creation_method', { count: 'exact' })
            .eq('creator_id', userId)
            .order('updated_at', { ascending: false })
            .range(parsedOffset, parsedOffset + parsedLimit - 1);

        if (error) throw error;

        res.json({
            success: true,
            projects: data || [],
            totalCount: count || 0,
            hasMore: (parsedOffset + parsedLimit) < (count || 0)
        });
    } catch (error) {
        console.error('[my] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch your projects' });
    }
});

// ============================================
// GET /api/projects/:id
// Returns project metadata + base64 bundle
// ============================================
// POST /api/projects/:id/export-apk
// Build an Android APK from the project's web bundle
// ============================================
router.post('/:id/export-apk', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, bundle: clientBundle } = req.body;

        if (!userId) return res.status(400).json({ error: 'userId is required' });

        // Get project
        const { data: project, error } = await supabase
            .from('projects')
            .select('id, title, github_repo, creator_id')
            .eq('id', id)
            .single();

        if (error || !project) return res.status(404).json({ error: 'Project not found' });

        // Get bundle: try client-provided bundle first, then DB bundle, then github repo
        let bundle = clientBundle || null;
        if (!bundle) {
            const { data: fullProject } = await supabase.from('projects').select('bundle').eq('id', id).single();
            if (fullProject?.bundle) bundle = fullProject.bundle;
        }
        if (!bundle && project.github_repo) {
            try {
                const bundleRes = await fetch(`${WORKER_URL}/bundle/${project.github_repo}`, {
                    headers: { 'x-worker-secret': WORKER_SECRET },
                    signal: AbortSignal.timeout(30000)
                });
                if (bundleRes.ok) {
                    const result = await bundleRes.json();
                    bundle = result.bundle;
                }
            } catch (e) {
                console.error(`[export-apk] Bundle fetch failed: ${e.message}`);
            }
        }

        if (!bundle) {
            return res.status(400).json({ error: 'Could not retrieve project bundle. Try previewing the project first.' });
        }

        console.log(`[export-apk] Building APK for project ${id}: "${project.title}"`);

        // Forward to worker for APK build (long timeout - Gradle takes ~60s)
        const workerRes = await fetch(`${WORKER_URL}/build-apk`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-worker-secret': WORKER_SECRET
            },
            body: JSON.stringify({
                projectId: id,
                bundle,
                appName: project.title || 'VibeBuild App'
            }),
            signal: AbortSignal.timeout(180000) // 3 min timeout
        });

        if (!workerRes.ok) {
            const err = await workerRes.json().catch(() => ({}));
            return res.status(500).json({ error: err.error || 'APK build failed' });
        }

        const result = await workerRes.json();
        console.log(`[export-apk] APK built: ${result.apkSize} bytes in ${result.buildTime}s`);
        res.json(result);
    } catch (error) {
        console.error(`[export-apk] Error:`, error.message);
        res.status(500).json({ error: `Export failed: ${error.message}` });
    }
});

// ============================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('projects')
            .select('id, title, description, github_repo, creator_id, creator_name, project_type, view_count, play_count, fork_count, like_count, created_at, updated_at, is_public, published_url, free_tweaks_remaining, initial_prompt')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Project not found' });

        // Fetch bundle from GitHub
        let bundle = null;
        if (data.github_repo) {
            try {
                const workerRes = await fetch(`${WORKER_URL}/bundle/${data.github_repo}`, {
                    headers: { 'x-worker-secret': WORKER_SECRET },
                    signal: AbortSignal.timeout(30000)
                });
                if (workerRes.ok) {
                    const result = await workerRes.json();
                    bundle = result.bundle;
                } else {
                    console.error(`[fetch] Bundle fetch failed: ${workerRes.status}`);
                }
            } catch (gitErr) {
                console.error(`[fetch] Bundle fetch error: ${gitErr.message}`);
            }
        }

        // Increment play count (fire-and-forget)
        supabase.from('projects').update({ play_count: (data.play_count || 0) + 1 }).eq('id', id).then(() => {}).catch(() => {});

        res.json({
            success: true,
            project: {
                id: data.id,
                title: data.title,
                description: data.description,
                bundle,
                githubRepo: data.github_repo,
                creatorId: data.creator_id,
                creatorName: data.creator_name,
                projectType: data.project_type,
                viewCount: data.view_count,
                playCount: data.play_count,
                forkCount: data.fork_count,
                likeCount: data.like_count,
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                isPublic: data.is_public,
                publishedUrl: data.published_url,
                freeTweaksRemaining: data.free_tweaks_remaining ?? FREE_TWEAKS_DEFAULT,
                initialPrompt: data.initial_prompt
            }
        });

    } catch (error) {
        console.error('[fetch] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// ============================================
// GET /api/projects/:id/files
// Parse the bundle into a file list (without full content for listing)
// Returns file names, sizes, and types extracted from the base64 zip bundle
// ============================================
router.get('/:id/files', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('projects')
            .select('id, bundle')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data || !data.bundle) return res.status(404).json({ error: 'Project or bundle not found' });

        // Proxy to worker which can unzip and list files
        try {
            const workerResponse = await fetch(`${WORKER_URL}/parse-bundle`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-worker-secret': WORKER_SECRET
                },
                body: JSON.stringify({ bundle: data.bundle }),
                signal: AbortSignal.timeout(30000)
            });

            if (workerResponse.ok) {
                const result = await workerResponse.json();
                return res.json({
                    success: true,
                    files: result.files || []
                });
            }
        } catch (workerErr) {
            console.warn('[files] Worker parse-bundle failed, falling back to basic info:', workerErr.message);
        }

        // Fallback: return basic bundle info without parsing
        const bundleBuffer = Buffer.from(data.bundle, 'base64');
        res.json({
            success: true,
            files: [{
                name: 'bundle.zip',
                size: bundleBuffer.length,
                type: 'application/zip'
            }],
            note: 'Full file listing unavailable; bundle returned as single zip entry'
        });

    } catch (error) {
        console.error('[files] Error:', error.message);
        res.status(500).json({ error: 'Failed to parse project files' });
    }
});

// ============================================
// POST /api/projects/:id/tweak
// Creator applies a tweak to their project.
// Checks subscription limits, proxies to worker with SSE.
// ============================================
router.post('/:id/tweak', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, tweakDescription } = req.body;

        console.log(`[tweak] Request: user=${userId}, project=${id}, desc="${(tweakDescription || '').substring(0, 80)}"`);

        if (!userId || !tweakDescription || tweakDescription.trim().length === 0) {
            return res.status(400).json({ error: 'userId and tweakDescription are required' });
        }

        if (tweakDescription.length > 2000) {
            return res.status(400).json({ error: 'Tweak description must be under 2000 characters' });
        }

        // 1. Verify user owns this project
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id, title, creator_id, bundle, github_repo, free_tweaks_remaining')
            .eq('id', id)
            .single();

        if (projectError || !project) {
            console.log(`[tweak] Project not found: ${id}`);
            return res.status(404).json({ error: 'Project not found' });
        }

        if (project.creator_id !== userId) {
            console.log(`[tweak] Not owner: user=${userId}, creator=${project.creator_id}`);
            return res.status(403).json({ error: 'Only the project creator can tweak this project' });
        }

        // 2. Check subscription usage limit for tweaks
        const limitCheck = await checkUsageLimit(userId, ACTION_TYPES.tweak, id);
        if (!limitCheck.allowed) {
            console.log(`[tweak] Usage limit exceeded: ${limitCheck.error}`);
            return res.status(403).json({
                error: limitCheck.error,
                used: limitCheck.used,
                limit: limitCheck.limit,
                remaining: limitCheck.remaining,
                requiresTier: limitCheck.requiresTier,
                currentTier: limitCheck.currentTier
            });
        }

        console.log(`[tweak] Usage check passed: tier=${limitCheck.tier}, used=${limitCheck.used}, limit=${limitCheck.limit}`);

        // 3. Ensure project has a GitHub repo for version tracking
        let repoName = project.github_repo;

        if (!repoName) {
            console.log(`[tweak] No repo exists, initializing for project ${id}`);

            try {
                const initResponse = await fetch(`${WORKER_URL}/init-repo`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-worker-secret': WORKER_SECRET
                    },
                    body: JSON.stringify({
                        projectId: id,
                        bundle: project.bundle,
                    }),
                    signal: AbortSignal.timeout(120000)
                });

                if (!initResponse.ok) {
                    const err = await initResponse.json().catch(() => ({}));
                    console.error(`[tweak] Repo init failed: ${err.error || initResponse.status}`);
                    return res.status(500).json({ error: 'Failed to initialize project repository' });
                }

                const initData = await initResponse.json();
                repoName = initData.repoName;

                // Save repo name to DB
                await supabase
                    .from('projects')
                    .update({ github_repo: repoName })
                    .eq('id', id);

                console.log(`[tweak] Repo initialized: ${repoName}`);
            } catch (initErr) {
                console.error(`[tweak] Repo init exception:`, initErr.message);
                return res.status(500).json({ error: 'Failed to initialize project repository' });
            }
        }

        // 4. Record usage for subscription tracking
        await recordUsage(userId, ACTION_TYPES.tweak, id);
        console.log(`[tweak] Usage recorded for user ${userId} on project ${id}`);

        // 5. Set up SSE streaming to client
        setupSSE(res);

        console.log(`[tweak] Proxying to worker: repo=${repoName}`);

        const workerResponse = await fetch(`${WORKER_URL}/tweak`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-worker-secret': WORKER_SECRET
            },
            body: JSON.stringify({
                projectId: id,
                repoName,
                tweakDescription: tweakDescription.trim(),
                stream: true
            }),
            signal: AbortSignal.timeout(600000)
        });

        if (!workerResponse.ok) {
            let errorMsg = `Build server error (${workerResponse.status})`;
            try {
                const err = await workerResponse.json();
                errorMsg = err.error || errorMsg;
            } catch {}

            res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
            res.end();
            return;
        }

        // Stream SSE from worker to client
        const resultReceived = await proxyWorkerSSE(workerResponse, res, {
            label: 'tweak',
            onResult: async (parsed, res) => {
                // Update the project's bundle in DB
                const updateData = {
                    bundle: parsed.bundle,
                    updated_at: new Date().toISOString()
                };
                if (parsed.commitSha) {
                    updateData.published_commit = parsed.commitSha;
                }

                await supabase
                    .from('projects')
                    .update(updateData)
                    .eq('id', id);

                console.log(`[tweak] Bundle updated for project ${id} (commit: ${parsed.commitSha || 'none'})`);

                res.write(`data: ${JSON.stringify({
                    type: 'result',
                    success: true,
                    bundle: parsed.bundle,
                    bundleSize: parsed.bundleSize,
                    commitSha: parsed.commitSha,
                    generationTime: parsed.generationTime,
                    tier: limitCheck.tier,
                    used: limitCheck.used !== undefined ? limitCheck.used + 1 : undefined,
                    limit: limitCheck.limit,
                    remaining: limitCheck.remaining !== undefined ? limitCheck.remaining - 1 : undefined,
                    unlimited: limitCheck.unlimited
                })}\n\n`);
            }
        });

        res.end();

    } catch (error) {
        console.error('[tweak] Error:', error.message);

        if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'Server error during tweak' })}\n\n`);
            res.end();
        } else {
            res.status(500).json({ error: 'Failed to apply tweak' });
        }
    }
});

// ============================================
// GET /api/projects/:id/versions
// Returns git commit history (version history) for a project
// ============================================
router.get('/:id/versions', async (req, res) => {
    try {
        const { id } = req.params;
        const limit = parseInt(req.query.limit) || 20;

        console.log(`[versions] Fetching versions for project ${id}`);

        // Get repo name from DB
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('github_repo, free_tweaks_remaining')
            .eq('id', id)
            .single();

        if (projectError || !project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        if (!project.github_repo) {
            console.log(`[versions] No repo for project ${id}`);
            return res.json({
                success: true,
                versions: [],
                hasRepo: false
            });
        }

        // Fetch from worker
        const workerResponse = await fetch(
            `${WORKER_URL}/versions/${project.github_repo}?limit=${limit}`,
            {
                headers: { 'x-worker-secret': WORKER_SECRET },
                signal: AbortSignal.timeout(15000)
            }
        );

        if (!workerResponse.ok) {
            throw new Error(`Worker error ${workerResponse.status}`);
        }

        const data = await workerResponse.json();
        console.log(`[versions] Got ${data.versions?.length || 0} versions for project ${id}`);

        res.json({
            success: true,
            versions: data.versions || [],
            hasRepo: true
        });

    } catch (error) {
        console.error('[versions] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch version history' });
    }
});

// ============================================
// POST /api/projects/:id/revert/:sha
// Revert a project to a specific git version (commit)
// ============================================
router.post('/:id/revert/:sha', async (req, res) => {
    try {
        const { id, sha } = req.params;
        const { userId } = req.body;

        console.log(`[revert] User ${userId} reverting project ${id} to commit ${sha.substring(0, 7)}`);

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        // Verify ownership
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id, creator_id, github_repo')
            .eq('id', id)
            .single();

        if (projectError || !project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        if (project.creator_id !== userId) {
            return res.status(403).json({ error: 'Only the project creator can revert' });
        }

        if (!project.github_repo) {
            return res.status(400).json({ error: 'Project has no version history' });
        }

        // Ask worker to checkout the commit and rebuild the bundle
        const workerResponse = await fetch(`${WORKER_URL}/revert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-worker-secret': WORKER_SECRET
            },
            body: JSON.stringify({
                repoName: project.github_repo,
                commitSha: sha
            }),
            signal: AbortSignal.timeout(60000)
        });

        if (!workerResponse.ok) {
            let errorMsg = `Worker error (${workerResponse.status})`;
            try {
                const err = await workerResponse.json();
                errorMsg = err.error || errorMsg;
            } catch {}
            return res.status(500).json({ error: errorMsg });
        }

        const revertData = await workerResponse.json();

        // Update project bundle in DB
        await supabase
            .from('projects')
            .update({
                bundle: revertData.bundle,
                published_commit: sha,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        console.log(`[revert] Project ${id} reverted to ${sha.substring(0, 7)}`);

        res.json({
            success: true,
            commitSha: sha,
            bundle: revertData.bundle,
            bundleSize: revertData.bundleSize
        });

    } catch (error) {
        console.error('[revert] Error:', error.message);
        res.status(500).json({ error: 'Failed to revert project' });
    }
});

// ============================================
// POST /api/projects/:id/fork
// Fork a project — costs FORK_COST coins, CREATOR_SHARE_PCT goes to original creator
// ============================================
router.post('/:id/fork', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, userName, newTitle } = req.body;

        if (!userId) return res.status(400).json({ error: 'userId is required' });

        console.log(`[fork] User ${userId} forking project ${id}`);

        // 1. Fetch the original project
        const { data: original, error: origError } = await supabase
            .from('projects')
            .select('id, title, description, bundle, creator_id, creator_name, project_type, initial_prompt')
            .eq('id', id)
            .single();

        if (origError || !original) {
            return res.status(404).json({ error: 'Project not found' });
        }

        if (!original.bundle) {
            return res.status(400).json({ error: 'Project has no bundle to fork' });
        }

        // 2. Cannot fork your own project
        if (original.creator_id === userId) {
            return res.status(400).json({ error: 'Cannot fork your own project. Use tweak instead.' });
        }

        // 3. Check subscription usage limit for forks (forks are allowed for all tiers)
        const limitCheck = await checkUsageLimit(userId, ACTION_TYPES.fork);
        if (!limitCheck.allowed) {
            console.log(`[fork] Usage limit exceeded: ${limitCheck.error}`);
            return res.status(403).json({
                error: limitCheck.error,
                requiresTier: limitCheck.requiresTier,
                currentTier: limitCheck.currentTier
            });
        }

        // 4. Record usage for subscription tracking
        await recordUsage(userId, ACTION_TYPES.fork, id);

        // 5. Create the forked project
        const forkId = crypto.randomUUID();
        const forkTitle = newTitle || `${original.title} (Fork)`;

        const { error: insertError } = await supabase
            .from('projects')
            .insert({
                id: forkId,
                title: forkTitle,
                description: `Forked from "${original.title}" by ${original.creator_name}. ${original.description || ''}`.substring(0, 500),
                bundle: original.bundle,
                creator_id: userId,
                creator_name: userName || 'Anonymous',
                project_type: original.project_type || 'web_app',
                initial_prompt: original.initial_prompt,
                is_public: true,
                play_count: 0,
                fork_count: 0,
                free_tweaks_remaining: FREE_TWEAKS_DEFAULT
            });

        if (insertError) throw insertError;

        // 6. Increment fork count on original
        await supabase
            .from('projects')
            .update({ fork_count: (original.fork_count || 0) + 1 })
            .eq('id', id);

        // 7. Refresh cache
        refreshBrowseCache();

        console.log(`[fork] Project ${forkId} forked from ${id} by user ${userId}`);

        res.json({
            success: true,
            projectId: forkId,
            title: forkTitle,
            tier: limitCheck.tier
        });

    } catch (error) {
        console.error('[fork] Error:', error.message);
        res.status(500).json({ error: 'Failed to fork project' });
    }
});

// ============================================
// DELETE /api/projects/:id
// Delete a project (only by creator)
// ============================================
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!userId) return res.status(400).json({ error: 'userId is required' });

        // Verify ownership
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id, creator_id, github_repo')
            .eq('id', id)
            .single();

        if (projectError || !project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        if (project.creator_id !== userId) {
            return res.status(403).json({ error: 'Only the project creator can delete this project' });
        }

        // Delete deployment if exists
        await supabase
            .from('deployments')
            .update({ status: 'deleted' })
            .eq('project_id', id);

        // Delete the project
        const { error: deleteError } = await supabase
            .from('projects')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;

        // If project had a GitHub repo, notify worker to clean up (fire-and-forget)
        if (project.github_repo) {
            fetch(`${WORKER_URL}/delete-repo`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-worker-secret': WORKER_SECRET
                },
                body: JSON.stringify({ repoName: project.github_repo })
            }).catch(err => console.warn('[delete] Repo cleanup failed:', err.message));
        }

        // Refresh cache
        refreshBrowseCache();

        console.log(`[delete] Project ${id} deleted by user ${userId}`);

        res.json({ success: true });

    } catch (error) {
        console.error('[delete] Error:', error.message);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// ============================================
// Cleanup stuck builds (called by Cloud Scheduler every 10 min)
// ============================================
router.post('/api/admin/cleanup-stuck-builds', async (req, res) => {
    const secret = req.headers['x-admin-secret'];
    if (secret !== process.env.WORKER_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago

        const { data: stuckProjects, error } = await supabase
            .from('projects')
            .select('id, creator_id, initial_prompt, created_at')
            .eq('status', 'building')
            .lt('created_at', cutoff);

        if (error) throw error;
        if (!stuckProjects?.length) return res.json({ cleaned: 0 });

        // Mark all as failed
        const ids = stuckProjects.map(p => p.id);
        await supabase.from('projects').update({ status: 'failed' }).in('id', ids);

        // Send push notifications
        for (const project of stuckProjects) {
            if (project.creator_id) {
                const shortPrompt = (project.initial_prompt || 'Your app').substring(0, 40);
                sendPushToUser(project.creator_id, 'Builders are overloaded 🔥', `"${shortPrompt}..." is in queue. Upgrade to Pro for priority builds that skip the line.`).catch(() => {});
            }
        }

        console.log(`[cleanup] Marked ${stuckProjects.length} stuck builds as failed: ${ids.join(', ')}`);
        res.json({ cleaned: stuckProjects.length, ids });

    } catch (err) {
        console.error('[cleanup] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

export default router;
