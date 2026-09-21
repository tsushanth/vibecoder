import express from 'express';
import {
    isValidDomain,
    addDomain,
    resolveDeploymentId,
    verifyDomain,
    getDomainStatus,
    removeDomain,
    normalizeDomain,
    DomainConfigError,
} from '../services/domainService.js';
import { getSubscriptionStatus } from '../services/subscriptionService.js';

const router = express.Router();

// Maps service errors to HTTP statuses so clients can tell "fix your input" from "try later".
function sendError(res, error, what) {
    console.error(`${what} error:`, error.message);
    if (error instanceof DomainConfigError) {
        return res.status(503).json({ error: 'Custom domains are temporarily unavailable. Please try again later.' });
    }
    const msg = error.message || '';
    const status = /already (registered|has a custom domain)/i.test(msg) ? 409
        : /not found|not owned/i.test(msg) ? 404
        : 500;
    return res.status(status).json({ error: msg });
}

// ─── POST /:deploymentId/add — Add a custom domain ───────────────────

router.post('/:deploymentId/add', async (req, res) => {
    try {
        const { deploymentId } = req.params;
        const { userId } = req.body;
        const domain = normalizeDomain(req.body.domain);

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

        const result = await addDomain(await resolveDeploymentId(deploymentId, userId), userId, domain);

        res.json({
            success: true,
            domain: result.domain,
            status: result.verification_status,
            instructions: {
                step1: `Add a CNAME record for "${result.domain}" pointing to "${result.cnameTarget}"`,
                step2: `For a root domain (no www), add A and AAAA records instead, using the values in apexRecords. Or add a TXT record at "${result.txtRecord}" with value "${result.txtValue}"`,
                step3: 'Click "Verify Domain" once DNS records are set (may take a few minutes to propagate)',
            },
            cnameTarget: result.cnameTarget,
            apexRecords: result.apexRecords,
            verificationToken: result.txtValue,
        });
    } catch (error) {
        sendError(res, error, 'Add domain');
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

        const result = await verifyDomain(await resolveDeploymentId(deploymentId, userId), userId);

        res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        sendError(res, error, 'Verify domain');
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

        const domainInfo = await getDomainStatus(await resolveDeploymentId(deploymentId, userId), userId);

        if (!domainInfo) {
            return res.json({ success: true, hasDomain: false });
        }

        res.json({
            success: true,
            hasDomain: true,
            ...domainInfo,
        });
    } catch (error) {
        sendError(res, error, 'Get domain status');
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

        const result = await removeDomain(await resolveDeploymentId(deploymentId, userId), userId);

        res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        sendError(res, error, 'Remove domain');
    }
});

export default router;
