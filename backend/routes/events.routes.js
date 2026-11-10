// The one-question "what were you hoping to make" prompt shown once after a person's first ready build (web).
//
//   GET  /api/events/first-build-survey?projectId=...   -> { eligible: boolean }
//   POST /api/events/first-build-survey { choice }       -> { success: true, recorded: boolean }
//
// Identity is the verified access token only. The answer is one of a fixed list of choices (lib/appEvents.js SURVEY_CHOICES),
// stored as the usage event first_build_survey with props.choice. There is no free text. A person is asked once: eligibility
// is false once any answer (including "dismissed") exists, and the database refuses a second row (unique index).
import express from 'express';
import { supabase as defaultClient } from '../config/database.js';
import { verifiedUserId } from '../lib/verifiedUser.js';
import { appEvents as defaultEvents, sourceFromRequest } from '../lib/appEventsInstance.js';
import { SURVEY_CHOICES } from '../lib/appEvents.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createEventsRouter({ verifyUser = verifiedUserId, client = defaultClient, events = defaultEvents } = {}) {
    const router = express.Router();

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

    return router;
}

export default createEventsRouter();
