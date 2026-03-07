import express from 'express';
import crypto from 'crypto';
import http2 from 'http2';
import { supabase } from '../config/database.js';
import {
    WORKER_URL,
    WORKER_SECRET,
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

const router = express.Router();

// ============================================
// APNs Push Notifications
// ============================================
const APNS_TEAM_ID = process.env.APNS_TEAM_ID || '7RS696YC75';
const APNS_KEY_ID = process.env.APNS_KEY_ID || 'KUXKM8UC3P';
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'com.kreativekoala.vibercoder';
// PEM key stored in env as single line with \n escaped, or multiline
const APNS_PRIVATE_KEY = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n');

let apnsJWT = null;
let apnsJWTIssuedAt = 0;

function getAPNsJWT() {
    const now = Math.floor(Date.now() / 1000);
    // Reuse token for up to 55 minutes (APNs tokens expire after 60 min)
    if (apnsJWT && (now - apnsJWTIssuedAt) < 55 * 60) return apnsJWT;
    if (!APNS_PRIVATE_KEY) return null;

    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: APNS_TEAM_ID, iat: now })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    const signature = sign.sign({ key: APNS_PRIVATE_KEY, format: 'pem', dsaEncoding: 'ieee-p1363' }).toString('base64url');
    apnsJWT = `${signingInput}.${signature}`;
    apnsJWTIssuedAt = now;
    return apnsJWT;
}

async function sendAPNsPush(deviceToken, title, body) {
    if (!deviceToken || !APNS_PRIVATE_KEY) return;
    const token = getAPNsJWT();
    if (!token) return;

    return new Promise((resolve) => {
        try {
            const client = http2.connect('https://api.push.apple.com');
            client.on('error', (err) => {
                console.error('[APNs] Connection error:', err.message);
                resolve();
            });

            const pushPayload = JSON.stringify({
                aps: { alert: { title, body }, sound: 'default', badge: 1 }
            });

            const req = client.request({
                ':method': 'POST',
                ':path': `/3/device/${deviceToken}`,
                ':scheme': 'https',
                ':authority': 'api.push.apple.com',
                'authorization': `bearer ${token}`,
                'apns-topic': APNS_BUNDLE_ID,
                'apns-push-type': 'alert',
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(pushPayload)
            });

            req.write(pushPayload);
            req.end();

            let responseData = '';
            req.on('data', (chunk) => { responseData += chunk; });
            req.on('response', (headers) => {
                const statusCode = headers[':status'];
                if (statusCode === 200) {
                    console.log(`[APNs] Push sent to ${deviceToken.substring(0, 8)}...`);
                } else {
                    console.error(`[APNs] Push failed: status=${statusCode} body=${responseData}`);
                }
                client.close();
                resolve();
            });

            req.on('error', (err) => {
                console.error('[APNs] Request error:', err.message);
                client.close();
                resolve();
            });
        } catch (err) {
            console.error('[APNs] Error:', err.message);
            resolve();
        }
    });
}

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
        const [newestResult, popularResult] = await Promise.all([
            supabase
                .from('projects')
                .select('id, title, description, creator_id, creator_name, project_type, play_count, fork_count, created_at, published_url', { count: 'exact' })
                .eq('is_public', true)
                .order('created_at', { ascending: false })
                .limit(200),
            supabase
                .from('projects')
                .select('id, title, description, creator_id, creator_name, project_type, play_count, fork_count, created_at, published_url')
                .eq('is_public', true)
                .order('play_count', { ascending: false })
                .limit(200),
        ]);

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
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Build server connection failed' })}\n\n`);
        res.end();
        return false;
    }

    const reader = workerResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let resultReceived = false;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events from the buffer
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const eventData = line.substring(6);
                    try {
                        const parsed = JSON.parse(eventData);

                        if (parsed.type === 'status') {
                            // Forward status to client (including progress fields)
                            res.write(`data: ${JSON.stringify({
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
                                await onResult(parsed, res);
                            } else {
                                res.write(`data: ${JSON.stringify(parsed)}\n\n`);
                            }
                        } else if (parsed.type === 'error') {
                            if (onError) {
                                await onError(parsed, res);
                            } else {
                                res.write(`data: ${JSON.stringify({
                                    type: 'error',
                                    error: parsed.error
                                })}\n\n`);
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
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'Connection to build server lost' })}\n\n`);
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

        if (!checkRateLimit(userId)) {
            return res.status(429).json({ error: 'Rate limit exceeded. Try again in an hour.' });
        }

        // Subscription usage check disabled until tables are created
        // TODO: Re-enable when user_subscriptions and subscription_usage tables exist

        console.log(`[generate] User ${userId}: "${prompt.substring(0, 80)}"${referenceImage ? ' (with reference image)' : ''}`);

        // Set up SSE
        setupSSE(res);

        // Build worker request body
        const workerBody = {
            prompt: prompt.trim(),
            userId,
            framework: framework || 'react',
            stream: true
        };
        if (referenceImage && typeof referenceImage === 'string') {
            workerBody.referenceImage = referenceImage;
        }

        // Request streaming from the worker
        const workerResponse = await fetch(`${WORKER_URL}/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-worker-secret': WORKER_SECRET
            },
            body: JSON.stringify(workerBody),
            signal: AbortSignal.timeout(600000) // 10 min timeout
        });

        if (!workerResponse.ok) {
            let errorMsg = `Build server error (${workerResponse.status})`;
            try {
                if (workerResponse.headers.get('content-type')?.includes('application/json')) {
                    const err = await workerResponse.json();
                    errorMsg = err.error || errorMsg;
                    if (err.quotaExhausted) {
                        res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg, quotaExhausted: true, resetTime: err.resetTime })}\n\n`);
                        res.end();
                        return;
                    }
                }
            } catch {}
            res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
            res.end();
            return;
        }

        // Stream SSE from worker to client
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

                res.write(`data: ${JSON.stringify({
                    type: 'result',
                    success: true,
                    generationId,
                    bundle: parsed.bundle,
                    bundleSize: parsed.bundleSize,
                    files: parsed.files,
                    generationTime: parsed.generationTime,
                    quality: parsed.quality
                })}\n\n`);

                // Send APNs push notification (fire-and-forget)
                if (deviceToken) {
                    const shortPrompt = prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt;
                    sendAPNsPush(deviceToken, 'Project Ready!', `"${shortPrompt}" has been built. Tap to view!`).catch(() => {});
                }
            }
        });

        res.end();

    } catch (error) {
        console.error('[generate] Error:', error.message);

        if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'Server error. Please try again.' })}\n\n`);
            res.end();
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
// POST /api/projects/suggest-ideas
// Return 6 random ideas from the built-in pool (always fresh)
// ============================================
router.post('/suggest-ideas', async (req, res) => {
    const shuffled = [...BUILT_IN_SUGGESTIONS].sort(() => Math.random() - 0.5);
    res.json({ success: true, suggestions: shuffled.slice(0, 6) });
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
            .select('id, title, description, creator_name, project_type, play_count, fork_count, created_at, updated_at, is_public, published_url', { count: 'exact' })
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
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('projects')
            .select('id, title, description, github_repo, creator_id, creator_name, project_type, play_count, fork_count, created_at, updated_at, is_public, published_url, free_tweaks_remaining, initial_prompt')
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
                playCount: data.play_count,
                forkCount: data.fork_count,
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

export default router;
