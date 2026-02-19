import express from 'express';
import { supabase } from '../config/database.js';
import { getActiveDomainMap } from '../services/domainService.js';

const DEPLOY_SERVER_URL = process.env.DEPLOY_SERVER_URL || 'http://localhost:4000';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'vibecoder-internal-secret';

const router = express.Router();

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

        if (existing) return res.status(409).json({ error: 'Subdomain already taken' });

        // Get project bundle
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('bundle, creator_id')
            .eq('id', projectId)
            .single();

        if (projectError || !project) return res.status(404).json({ error: 'Project not found' });
        if (project.creator_id !== userId) return res.status(403).json({ error: 'Not authorized' });

        // Send to deploy server
        const deployResponse = await fetch(`${DEPLOY_SERVER_URL}/deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subdomain, bundle: project.bundle })
        });

        if (!deployResponse.ok) {
            const err = await deployResponse.json().catch(() => ({}));
            return res.status(500).json({ error: err.error || 'Deployment failed' });
        }

        // Upsert deployment record
        await supabase.from('deployments').upsert({
            project_id: projectId,
            user_id: userId,
            subdomain,
            bundle: project.bundle,
            status: 'active',
            deployed_at: new Date().toISOString()
        }, { onConflict: 'project_id' });

        // Update project with published URL
        const url = `https://${subdomain}.vibecoder.app`;
        await supabase.from('projects').update({ published_url: url }).eq('id', projectId);

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
        const { data } = await supabase.from('deployments').select('subdomain, status, deployed_at').eq('project_id', projectId).single();

        if (!data) return res.json({ success: true, deployed: false });

        res.json({
            success: true,
            deployed: data.status === 'active',
            subdomain: data.subdomain,
            url: `https://${data.subdomain}.vibecoder.app`,
            deployedAt: data.deployed_at
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check deployment' });
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
