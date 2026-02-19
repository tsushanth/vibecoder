import express from 'express';
import {
    isValidDomain,
    addDomain,
    verifyDomain,
    getDomainStatus,
    removeDomain,
} from '../services/domainService.js';
import { getSubscriptionStatus } from '../services/subscriptionService.js';

const router = express.Router();

// ─── POST /:deploymentId/add — Add a custom domain ───────────────────

router.post('/:deploymentId/add', async (req, res) => {
    try {
        const { deploymentId } = req.params;
        const { userId, domain } = req.body;

        if (!userId || !domain) {
            return res.status(400).json({ error: 'userId and domain are required' });
        }

        // Gate behind Pro subscription
        const sub = await getSubscriptionStatus(userId);
        const tier = sub?.tier || sub?.subscription?.tier || 'free';
        if (tier === 'free') {
            return res.status(403).json({
                error: 'Custom domains require a Pro subscription',
                upgrade: true,
            });
        }

        // Validate domain format
        if (!isValidDomain(domain)) {
            return res.status(400).json({
                error: 'Invalid domain format. Use a valid domain like myapp.com or app.example.com',
            });
        }

        const result = await addDomain(deploymentId, userId, domain);

        res.json({
            success: true,
            domain: result.domain,
            status: result.verification_status,
            instructions: {
                step1: `Add a CNAME record for "${result.domain}" pointing to "${result.cnameTarget}"`,
                step2: `Or add a TXT record at "${result.txtRecord}" with value "${result.txtValue}"`,
                step3: 'Click "Verify Domain" once DNS records are set (may take a few minutes to propagate)',
            },
            cnameTarget: result.cnameTarget,
            verificationToken: result.txtValue,
        });
    } catch (error) {
        console.error('Add domain error:', error);
        const status = error.message.includes('already registered') ? 409 : 500;
        res.status(status).json({ error: error.message });
    }
});

// ─── POST /:deploymentId/verify — Verify DNS and provision SSL ───────

router.post('/:deploymentId/verify', async (req, res) => {
    try {
        const { deploymentId } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await verifyDomain(deploymentId, userId);

        res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error('Verify domain error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── GET /:deploymentId — Get domain status ──────────────────────────

router.get('/:deploymentId', async (req, res) => {
    try {
        const { deploymentId } = req.params;
        const userId = req.query.userId;

        if (!userId) {
            return res.status(400).json({ error: 'userId query parameter is required' });
        }

        const domainInfo = await getDomainStatus(deploymentId, userId);

        if (!domainInfo) {
            return res.json({ success: true, hasDomain: false });
        }

        res.json({
            success: true,
            hasDomain: true,
            ...domainInfo,
        });
    } catch (error) {
        console.error('Get domain status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── DELETE /:deploymentId — Remove custom domain ────────────────────

router.delete('/:deploymentId', async (req, res) => {
    try {
        const { deploymentId } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await removeDomain(deploymentId, userId);

        res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error('Remove domain error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
