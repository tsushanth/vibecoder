import dns from 'dns/promises';
import crypto from 'crypto';
import { supabase } from '../config/database.js';

const FLY_API_TOKEN = process.env.FLY_API_TOKEN;
const FLY_APP_NAME = process.env.FLY_DEPLOY_APP_NAME || 'vibecoder-deploy';
const FLY_API_BASE = 'https://api.machines.dev/v1';
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'vibecoder.app';

// ─── Domain validation ────────────────────────────────────────────────

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') return false;
    const cleaned = domain.toLowerCase().trim();
    if (cleaned.length > 253) return false;
    if (cleaned.endsWith(`.${BASE_DOMAIN}`)) return false; // can't use our own domain
    return DOMAIN_REGEX.test(cleaned);
}

export function generateVerificationToken() {
    return `vibe-verify-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

// ─── DNS verification ─────────────────────────────────────────────────

export async function verifyCNAME(domain, expectedSubdomain) {
    try {
        const records = await dns.resolveCname(domain);
        const target = `${expectedSubdomain}.${BASE_DOMAIN}`;
        return records.some(r => r.toLowerCase() === target.toLowerCase());
    } catch (err) {
        // CNAME may not exist — try A record pointing to our IP
        if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
            return false;
        }
        throw err;
    }
}

export async function verifyTXTToken(domain, expectedToken) {
    try {
        const prefix = '_vibebuilder';
        const records = await dns.resolveTxt(`${prefix}.${domain}`);
        // TXT records come as arrays of strings
        return records.some(chunks => chunks.join('').trim() === expectedToken);
    } catch {
        return false;
    }
}

// ─── Fly.io SSL certificate management ────────────────────────────────

async function flyRequest(path, method = 'GET', body = null) {
    if (!FLY_API_TOKEN) {
        console.warn('FLY_API_TOKEN not set — skipping Fly.io API call');
        return { simulated: true };
    }

    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${FLY_API_TOKEN}`,
            'Content-Type': 'application/json',
        },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${FLY_API_BASE}${path}`, options);

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Fly.io API error (${response.status}): ${text}`);
    }

    return response.json();
}

export async function provisionSSLCert(domain) {
    return flyRequest(`/apps/${FLY_APP_NAME}/certificates`, 'POST', {
        hostname: domain,
    });
}

export async function getSSLCertStatus(domain) {
    return flyRequest(`/apps/${FLY_APP_NAME}/certificates/${domain}`);
}

export async function deleteSSLCert(domain) {
    return flyRequest(`/apps/${FLY_APP_NAME}/certificates/${domain}`, 'DELETE');
}

// ─── Database operations ──────────────────────────────────────────────

export async function addDomain(deploymentId, userId, domain) {
    const cleanDomain = domain.toLowerCase().trim();
    const token = generateVerificationToken();

    // Get the deployment's subdomain for CNAME target
    const { data: deployment, error: depError } = await supabase
        .from('deployments')
        .select('subdomain')
        .eq('id', deploymentId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();

    if (depError || !deployment) {
        throw new Error('Deployment not found or not owned by user');
    }

    // Check if domain is already registered
    const { data: existing } = await supabase
        .from('custom_domains')
        .select('id')
        .eq('domain', cleanDomain)
        .single();

    if (existing) {
        throw new Error('Domain is already registered');
    }

    const { data, error } = await supabase
        .from('custom_domains')
        .insert({
            deployment_id: deploymentId,
            user_id: userId,
            domain: cleanDomain,
            verification_token: token,
            verification_status: 'pending',
        })
        .select()
        .single();

    if (error) throw error;

    return {
        ...data,
        cnameTarget: `${deployment.subdomain}.${BASE_DOMAIN}`,
        txtRecord: `_vibebuilder.${cleanDomain}`,
        txtValue: token,
    };
}

export async function verifyDomain(deploymentId, userId) {
    // Fetch the domain record
    const { data: domainRecord, error } = await supabase
        .from('custom_domains')
        .select('*, deployments!inner(subdomain)')
        .eq('deployment_id', deploymentId)
        .eq('user_id', userId)
        .single();

    if (error || !domainRecord) {
        throw new Error('Domain record not found');
    }

    if (domainRecord.verification_status === 'active') {
        return { status: 'active', message: 'Domain already verified and active' };
    }

    const subdomain = domainRecord.deployments.subdomain;

    // Check CNAME
    const cnameValid = await verifyCNAME(domainRecord.domain, subdomain);

    // Also accept TXT verification as an alternative
    const txtValid = await verifyTXTToken(domainRecord.domain, domainRecord.verification_token);

    if (!cnameValid && !txtValid) {
        await supabase
            .from('custom_domains')
            .update({ last_checked_at: new Date().toISOString() })
            .eq('id', domainRecord.id);

        return {
            status: 'pending',
            message: 'DNS verification failed',
            cnameExpected: `${subdomain}.${BASE_DOMAIN}`,
            cnameFound: cnameValid,
            txtExpected: domainRecord.verification_token,
            txtFound: txtValid,
        };
    }

    // DNS verified — provision SSL
    await supabase
        .from('custom_domains')
        .update({
            verification_status: 'ssl_provisioning',
            last_checked_at: new Date().toISOString(),
        })
        .eq('id', domainRecord.id);

    try {
        const certResult = await provisionSSLCert(domainRecord.domain);
        const certId = certResult.id || certResult.hostname || domainRecord.domain;

        await supabase
            .from('custom_domains')
            .update({
                verification_status: 'active',
                ssl_certificate_id: certId,
                updated_at: new Date().toISOString(),
            })
            .eq('id', domainRecord.id);

        // Also update the deployments table custom_domain column
        await supabase
            .from('deployments')
            .update({ custom_domain: domainRecord.domain })
            .eq('id', deploymentId);

        return { status: 'active', message: 'Domain verified and SSL provisioned' };
    } catch (sslErr) {
        await supabase
            .from('custom_domains')
            .update({
                verification_status: 'dns_verified',
                last_checked_at: new Date().toISOString(),
            })
            .eq('id', domainRecord.id);

        return {
            status: 'dns_verified',
            message: `DNS verified but SSL provisioning failed: ${sslErr.message}`,
        };
    }
}

export async function getDomainStatus(deploymentId, userId) {
    const { data, error } = await supabase
        .from('custom_domains')
        .select('*, deployments!inner(subdomain)')
        .eq('deployment_id', deploymentId)
        .eq('user_id', userId)
        .single();

    if (error || !data) return null;

    return {
        id: data.id,
        domain: data.domain,
        status: data.verification_status,
        cnameTarget: `${data.deployments.subdomain}.${BASE_DOMAIN}`,
        txtRecord: `_vibebuilder.${data.domain}`,
        txtValue: data.verification_token,
        sslCertificateId: data.ssl_certificate_id,
        lastCheckedAt: data.last_checked_at,
        createdAt: data.created_at,
    };
}

export async function removeDomain(deploymentId, userId) {
    const { data: domainRecord, error } = await supabase
        .from('custom_domains')
        .select('domain, ssl_certificate_id')
        .eq('deployment_id', deploymentId)
        .eq('user_id', userId)
        .single();

    if (error || !domainRecord) {
        throw new Error('Domain record not found');
    }

    // Revoke SSL cert if it exists
    if (domainRecord.ssl_certificate_id) {
        try {
            await deleteSSLCert(domainRecord.domain);
        } catch (err) {
            console.warn(`Failed to revoke SSL cert for ${domainRecord.domain}:`, err.message);
        }
    }

    // Delete the record
    await supabase
        .from('custom_domains')
        .delete()
        .eq('deployment_id', deploymentId)
        .eq('user_id', userId);

    // Clear custom_domain on the deployment
    await supabase
        .from('deployments')
        .update({ custom_domain: null })
        .eq('id', deploymentId);

    return { removed: true, domain: domainRecord.domain };
}

// ─── Domain map for deploy server ─────────────────────────────────────

export async function getActiveDomainMap() {
    const { data, error } = await supabase
        .from('custom_domains')
        .select('domain, deployments!inner(subdomain)')
        .eq('verification_status', 'active');

    if (error || !data) return [];

    return data.map(d => ({
        domain: d.domain,
        subdomain: d.deployments.subdomain,
    }));
}
