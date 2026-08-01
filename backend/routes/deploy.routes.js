import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/database.js';
import { getActiveDomainMap } from '../services/domainService.js';
import { WORKER_URL, WORKER_SECRET } from '../config/constants.js';

const DEPLOY_SERVER_URL = process.env.DEPLOY_SERVER_URL || 'http://localhost:4000';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'vibecoder-internal-secret';

const router = express.Router();

// Preview deploy - creates a temporary deployment for iOS preview (no DB record)
router.post('/preview', async (req, res) => {
    try {
        const { bundle } = req.body;
        if (!bundle) return res.status(400).json({ error: 'bundle is required' });

        // Generate a random preview subdomain
        const previewId = crypto.randomBytes(8).toString('hex');
        const subdomain = `preview-${previewId}`;

        // Send to deploy server
        const deployResponse = await fetch(`${DEPLOY_SERVER_URL}/deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subdomain, bundle })
        });

        if (!deployResponse.ok) {
            const err = await deployResponse.json().catch(() => ({}));
            return res.status(500).json({ error: err.error || 'Preview deployment failed' });
        }

        // Use path-based URL (works without wildcard DNS setup)
        const url = `${DEPLOY_SERVER_URL}/p/${subdomain}/`;
        res.json({ success: true, url, subdomain });
    } catch (error) {
        console.error('Preview deploy error:', error);
        res.status(500).json({ error: 'Preview deployment failed' });
    }
});

router.post('/:projectId/deploy', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { userId, subdomain } = req.body;
        if (!userId || !subdomain) return res.status(400).json({ error: 'userId and subdomain are required' });

        // Validate subdomain
        if (!/^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/.test(subdomain)) {
            return res.status(400).json({ error: 'Invalid subdomain. Use lowercase letters, numbers, and hyphens.' });
        }

        // Check subdomain availability
        const { data: existing } = await supabase
            .from('deployments')
            .select('id')
            .eq('subdomain', subdomain)
            .neq('project_id', projectId)
            .single();

        if (existing) return res.status(409).json({ error: 'This subdomain is already taken by another project. If it\'s yours, remove it first from that project, then try again.' });

        // Get project
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('bundle, creator_id, github_repo')
            .eq('id', projectId)
            .single();

        if (projectError || !project) return res.status(404).json({ error: 'Project not found' });
        if (project.creator_id !== userId) return res.status(403).json({ error: 'Not authorized' });

        // Always fetch latest bundle from git if repo exists, fallback to DB bundle
        let bundle = project.bundle;
        if (project.github_repo) {
            try {
                const workerRes = await fetch(`${WORKER_URL}/bundle/${project.github_repo}`, {
                    headers: { 'x-worker-secret': WORKER_SECRET },
                    signal: AbortSignal.timeout(60000)
                });
                if (workerRes.ok) {
                    const result = await workerRes.json();
                    bundle = result.bundle;
                    console.log(`[deploy] Fetched latest bundle from git for ${projectId} (commit: ${result.commitSha?.substring(0, 7)})`);
                    // Cache it back to DB so future deploys are instant even if the worker is unreachable
                    if (bundle) {
                        await supabase.from('projects').update({ bundle }).eq('id', projectId);
                    }
                } else {
                    console.warn(`[deploy] Worker bundle fetch failed (${workerRes.status}), falling back to DB bundle`);
                }
            } catch (err) {
                console.warn(`[deploy] Worker bundle fetch error: ${err.message}, falling back to DB bundle`);
            }
        }

        if (!bundle) return res.status(400).json({ error: 'No bundle available for this project' });

        // Send to deploy server
        const deployResponse = await fetch(`${DEPLOY_SERVER_URL}/deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subdomain, bundle })
        });

        if (!deployResponse.ok) {
            const err = await deployResponse.json().catch(() => ({}));
            return res.status(500).json({ error: err.error || 'Deployment failed' });
        }

        // Upsert deployment record (conflict on subdomain which has the UNIQUE constraint)
        const { error: upsertError } = await supabase.from('deployments').upsert({
            project_id: projectId,
            user_id: userId,
            subdomain,
            bundle,
            status: 'active',
            deployed_at: new Date().toISOString()
        }, { onConflict: 'subdomain' });
        if (upsertError) console.error('[deploy] deployments upsert error:', upsertError);

        // Update project with published URL and clean up preview
        const url = `https://${subdomain}.vibebuild.cc`;
        const { data: proj } = await supabase.from('projects').select('preview_url').eq('id', projectId).single();
        await supabase.from('projects').update({ published_url: url, preview_url: null }).eq('id', projectId);

        // Clean up preview deployment files (fire-and-forget)
        if (proj?.preview_url) {
            const previewSubdomain = proj.preview_url.replace('https://', '').split('.')[0];
            fetch(`${DEPLOY_SERVER_URL}/cleanup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subdomain: previewSubdomain })
            }).catch(() => {});
            console.log(`[deploy] Cleaned up preview: ${previewSubdomain}`);
        }

        res.json({ success: true, url });
    } catch (error) {
        console.error('Deploy error:', error);
        res.status(500).json({ error: 'Deployment failed' });
    }
});

router.delete('/:projectId/deploy', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { userId } = req.body;

        await supabase.from('deployments').update({ status: 'deleted' }).eq('project_id', projectId).eq('user_id', userId);
        await supabase.from('projects').update({ published_url: null }).eq('id', projectId);

        res.json({ success: true });
    } catch (error) {
        console.error('Undeploy error:', error);
        res.status(500).json({ error: 'Failed to remove deployment' });
    }
});

router.get('/:projectId/deploy', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { data } = await supabase.from('deployments').select('subdomain, status, deployed_at, ads_enabled').eq('project_id', projectId).single();

        if (!data) return res.json({ success: true, deployed: false });

        res.json({
            success: true,
            deployed: data.status === 'active',
            subdomain: data.subdomain,
            url: `https://${data.subdomain}.vibebuild.cc`,
            deployedAt: data.deployed_at,
            adsEnabled: data.ads_enabled || false
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check deployment' });
    }
});

// Toggle ads for a deployment
router.post('/:projectId/ads', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { userId, enabled } = req.body;

        if (!userId) return res.status(400).json({ error: 'userId is required' });
        if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) is required' });

        // Verify ownership
        const { data: project } = await supabase.from('projects').select('creator_id').eq('id', projectId).single();
        if (!project || project.creator_id !== userId) return res.status(403).json({ error: 'Not authorized' });

        // Update deployment
        const { error } = await supabase.from('deployments').update({ ads_enabled: enabled }).eq('project_id', projectId);
        if (error) throw error;

        console.log(`[ads] ${enabled ? 'Enabled' : 'Disabled'} ads for project ${projectId}`);
        res.json({ success: true, adsEnabled: enabled });
    } catch (error) {
        console.error('[ads] Error:', error.message);
        res.status(500).json({ error: 'Failed to update ads setting' });
    }
});

// Internal endpoint for deploy server to fetch domain map
router.get('/internal/domain-map', async (req, res) => {
    try {
        const secret = req.headers['x-internal-secret'];
        if (secret !== INTERNAL_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const mappings = await getActiveDomainMap();
        res.json({ success: true, mappings });
    } catch (error) {
        console.error('Domain map error:', error);
        res.status(500).json({ error: 'Failed to fetch domain map' });
    }
});

export default router;
