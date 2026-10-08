import express from 'express';
import rateLimit from 'express-rate-limit';
import { supabase as defaultSupabase } from '../config/database.js';
import { verifiedUserId } from '../lib/verifiedUser.js';

// POST /api/subscriptions/portal   (Authorization: Bearer <access token>, no body)
// Opens Stripe's customer portal for the caller's own web subscription, where they can cancel, update the card and see invoices.
//   200 { url }                     send the browser there
//   401 unauthorized                no or bad token
//   404 no_web_subscription         nothing to manage here (free, or the plan was bought in Google Play or the App Store)
//   503 billing_unavailable         Stripe is not configured
//   502 portal_unavailable          Stripe refused or could not be reached
// Identity comes ONLY from the verified token. The Stripe customer is found from the subscription id the webhook stored for that user,
// so nobody can open another person's portal by naming them.
export function createBillingPortalRouter({ stripe, supabase = defaultSupabase, verifyUser = verifiedUserId, returnUrl, configurationId, log = console.error, maxPerMinute = 10 } = {}) {
    const router = express.Router();
    router.use(rateLimit({ windowMs: 60_000, limit: maxPerMinute, standardHeaders: false, legacyHeaders: false, message: { error: 'rate_limited' } }));
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    router.post('/', async (req, res) => {
        const userId = await verifyUser(req);
        if (!userId) return res.status(401).json({ error: 'unauthorized' });
        if (!stripe) return res.status(503).json({ error: 'billing_unavailable' });

        try {
            const { data: row, error } = await supabase
                .from('user_subscriptions')
                .select('platform, product_id, status')
                .eq('user_id', userId)
                .maybeSingle();
            if (error) throw error;
            if (!row || row.platform !== 'web' || typeof row.product_id !== 'string' || !row.product_id.startsWith('sub_')) {
                return res.status(404).json({ error: 'no_web_subscription' });
            }

            const subscription = await stripe.subscriptions.retrieve(row.product_id);
            const customer = typeof subscription?.customer === 'string' ? subscription.customer : subscription?.customer?.id;
            if (!customer) return res.status(404).json({ error: 'no_web_subscription' });

            const session = await stripe.billingPortal.sessions.create({ customer, return_url: returnUrl, ...(configurationId ? { configuration: configurationId } : {}) });
            return res.json({ url: session.url });
        } catch (e) {
            if (e?.code === 'resource_missing') return res.status(404).json({ error: 'no_web_subscription' });
            log(`[billing-portal] failed code=${e?.code || e?.type || 'error'}`);
            return res.status(502).json({ error: 'portal_unavailable' });
        }
    });

    return router;
}
