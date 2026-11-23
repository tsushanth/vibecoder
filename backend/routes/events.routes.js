// The one-question "what were you hoping to make" prompt shown once after a person's first ready build (web).
//
//   GET  /api/events/first-build-survey?projectId=...   -> { eligible: boolean }
//   POST /api/events/first-build-survey { choice }       -> { success: true, recorded: boolean }
//   POST /api/events/promo { action, surface, lang }     -> { success: true }   (app promotion of the chat channels, see below)
//
// Identity is the verified access token only. The answer is one of a fixed list of choices (lib/appEvents.js SURVEY_CHOICES),
// stored as the usage event first_build_survey with props.choice. There is no free text. A person is asked once: eligibility
// is false once any answer (including "dismissed") exists, and the database refuses a second row (unique index).
import express from 'express';
import { supabase as defaultClient } from '../config/database.js';
import { verifiedUserId } from '../lib/verifiedUser.js';
import { appEvents as defaultEvents, sourceFromRequest } from '../lib/appEventsInstance.js';
import { SURVEY_CHOICES, PROMO_SURFACES } from '../lib/appEvents.js';
import { createWindowLimiter } from '../lib/rateWindow.js';

// Chat-channel promotion events from the app: one of impression | tap | dismiss on one of the closed list of surfaces (banner,
// create_card, post_build, account_row). The person must be signed in (verified token): anonymous traffic is refused, not stored.
// Stored as app_events promo_impression / promo_tap / promo_dismiss with only { surface, lang, source }. Fire and forget: the answer
// does not wait for the database, and a refused or failed event is never an error the app has to handle.
const PROMO_ACTIONS = Object.freeze({ impression: 'promo_impression', tap: 'promo_tap', dismiss: 'promo_dismiss' });
const APP_PROMO_SURFACES = new Set(PROMO_SURFACES.filter((s) => !s.startsWith('web_'))); // the web surfaces are counted by the website's visit counter, not here
const PROMO_PER_MINUTE = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createEventsRouter({ verifyUser = verifiedUserId, client = defaultClient, events = defaultEvents, now = () => Date.now() } = {}) {
    const router = express.Router();
    const promoLimit = createWindowLimiter({ windowMs: 60_000, max: PROMO_PER_MINUTE, now });

    router.get('/first-build-survey', async (req, res) => {
        try {
            const userId = await verifyUser(req);
            if (!userId) return res.status(401).json({ error: 'Sign in again.' });
            const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
            if (!UUID.test(projectId)) return res.json({ eligible: false });

            // Already answered or dismissed. A lookup error (e.g. the table is not there yet) means "do not ask": an answer could not be stored.
            const answered = await client.from('app_events').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('event', 'first_build_survey');
            if (answered.error || (answered.count ?? 0) > 0) return res.json({ eligible: false });

            // The build must be this person's own, and they must have no other ready build (this is their first one).
            const own = await client.from('projects').select('id').eq('id', projectId).eq('creator_id', userId).maybeSingle();
            if (own.error || !own.data) return res.json({ eligible: false });
            const others = await client.from('projects').select('id').eq('creator_id', userId).eq('status', 'ready').neq('id', projectId).limit(1);
            if (others.error || (others.data || []).length > 0) return res.json({ eligible: false });

            res.json({ eligible: true });
        } catch {
            res.json({ eligible: false });
        }
    });

    router.post('/first-build-survey', async (req, res) => {
        try {
            const userId = await verifyUser(req);
            if (!userId) return res.status(401).json({ error: 'Sign in again.' });
            const choice = req.body?.choice;
            if (typeof choice !== 'string' || !SURVEY_CHOICES.includes(choice)) return res.status(400).json({ error: 'Unknown choice.' });
            const r = await events.record('first_build_survey', { userId, props: { choice, source: sourceFromRequest(req) } });
            if (r.ok) return res.json({ success: true, recorded: true });
            if (r.reason === 'duplicate') return res.json({ success: true, recorded: false });
            return res.status(503).json({ error: 'Could not save that right now.' });
        } catch {
            res.status(500).json({ error: 'Could not save that right now.' });
        }
    });

    router.post('/promo', async (req, res) => {
        try {
            const userId = await verifyUser(req);
            if (!userId) return res.status(401).json({ error: 'Sign in again.' });
            const event = typeof req.body?.action === 'string' ? PROMO_ACTIONS[req.body.action] : undefined;
            const surface = req.body?.surface;
            if (!event || typeof surface !== 'string' || !APP_PROMO_SURFACES.has(surface)) return res.status(400).json({ error: 'Unknown promotion event.' });
            if (!promoLimit.hit(userId)) return res.status(429).json({ error: 'Too many events.' });
            events.emit(event, { userId, props: { surface, lang: req.body?.lang, source: sourceFromRequest(req) } });
            res.json({ success: true });
        } catch {
            res.status(500).json({ error: 'Could not save that right now.' });
        }
    });

    return router;
}

export default createEventsRouter();
