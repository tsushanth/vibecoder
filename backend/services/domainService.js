import dnsPromises from 'dns/promises';
import crypto from 'crypto';
import net from 'net';
import { supabase as defaultSupabase } from '../config/database.js';
import { createProxyAdmin } from './proxyAdmin.js';
import { syncCustomDomain } from './appRegistry.js';

const FLY_API_BASE = 'https://api.machines.dev/v1';
const STALE_CLAIM_MS = 60 * 60 * 1000; // an unverified claim older than this can be taken over

// Custom domains are served by the vibecoder-deploy Fly app. These are its public
// traffic addresses, used for apex-domain (A/AAAA) instructions and verification.
const split = (v, fallback) => (v || fallback).split(',').map((s) => s.trim()).filter(Boolean);

export class DomainConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DomainConfigError';
        this.code = 'DOMAINS_NOT_CONFIGURED';
    }
}

// ─── Pure helpers ─────────────────────────────────────────────────────

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Accepts what users paste ("https://www.Example.com/"), returns a bare lowercase hostname. */
export function normalizeDomain(input) {
    if (typeof input !== 'string') return '';
    return input
        .trim()
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .replace(/[/?#].*$/, '')
        .replace(/:\d+$/, '')
        .replace(/\.$/, '');
}

export function isValidDomain(domain, baseDomain = process.env.BASE_DOMAIN || 'vibebuild.cc') {
    if (!domain || typeof domain !== 'string') return false;
    const cleaned = domain.toLowerCase().trim();
    if (cleaned.length > 253) return false;
    if (cleaned === baseDomain || cleaned.endsWith(`.${baseDomain}`)) return false; // can't use our own domain
    if (cleaned.endsWith('.fly.dev') || cleaned.endsWith('.internal')) return false;
    return DOMAIN_REGEX.test(cleaned);
}

export function generateVerificationToken() {
    return `vibe-verify-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Canonical form so '2A09:8280:1::117:24DA:0' and '2a09:8280:1:0:0:117:24da:0' compare equal. */
export function normalizeIp(ip) {
    const v = net.isIP(ip);
    if (v === 4) return ip;
    if (v === 6) {
        try { return new URL(`http://[${ip}]`).hostname.slice(1, -1); } catch { return ip.toLowerCase(); }
    }
    return String(ip).toLowerCase();
}

/** True when a Fly certificate object describes a served, unexpired certificate. */
export function isCertReady(cert, now = Date.now()) {
    if (!cert) return false;
    const issued = (cert.certificates || []).flatMap((c) => c.issued || []);
    const live = issued.some((i) => !i.expires_at || new Date(i.expires_at).getTime() > now);
    return Boolean(cert.configured) && live;
}

// ─── Service factory (dependencies injectable for tests) ──────────────

export function createDomainService({
    supabase = defaultSupabase,
    dns = dnsPromises,
    fetchFn = (...args) => fetch(...args),
    env = process.env,
    now = () => Date.now(),
    onDomainChange = null, // async ({ subdomain, domain|null }): tells the platform proxy which custom domain an app has
} = {}) {
    const BASE_DOMAIN = env.BASE_DOMAIN || 'vibebuild.cc';
    const FLY_APP_NAME = env.FLY_DEPLOY_APP_NAME || 'vibecoder-deploy';
    const trafficA = split(env.DEPLOY_IPV4, '66.241.125.51');
    const trafficAAAA = split(env.DEPLOY_IPV6, '2a09:8280:1::117:24da:0');

    // ── DNS ──
    async function verifyCNAME(domain, expectedSubdomain) {
        try {
            const records = await dns.resolveCname(domain);
            const target = `${expectedSubdomain}.${BASE_DOMAIN}`.toLowerCase();
            return records.some((r) => r.toLowerCase().replace(/\.$/, '') === target);
        } catch (err) {
            if (['ENODATA', 'ENOTFOUND', 'ENOENT', 'ESERVFAIL', 'ETIMEOUT'].includes(err.code)) return false;
            throw err;
        }
    }

    /** Apex domains cannot CNAME, so accept A/AAAA records that point at our servers. */
    async function verifyAddressRecords(domain) {
        const want4 = new Set(trafficA.map(normalizeIp));
        const want6 = new Set(trafficAAAA.map(normalizeIp));
        const safe = async (fn) => { try { return await fn(domain); } catch { return []; } };
        const [a, aaaa] = await Promise.all([safe(dns.resolve4), safe(dns.resolve6)]);
        const okA = a.some((ip) => want4.has(normalizeIp(ip)));
        const okAAAA = aaaa.some((ip) => want6.has(normalizeIp(ip)));
        return okA || okAAAA;
    }

    async function verifyTXTToken(domain, expectedToken) {
        try {
            const records = await dns.resolveTxt(`_vibebuilder.${domain}`);
            return records.some((chunks) => chunks.join('').trim() === expectedToken);
        } catch {
            return false;
        }
    }

    // ── Fly certificates (Machines API) ──
    function flyHeaders() {
        const token = env.FLY_API_TOKEN;
        if (!token) throw new DomainConfigError('Custom domains are not configured on this server');
        // `fly tokens create` emits macaroon tokens that already start with "FlyV1 ".
        const authorization = token.startsWith('FlyV1 ') ? token : `Bearer ${token}`;
        return { Authorization: authorization, 'Content-Type': 'application/json' };
    }

    async function flyRequest(path, method = 'GET', body = null) {
        const options = { method, headers: flyHeaders(), signal: AbortSignal.timeout(20_000) };
        if (body) options.body = JSON.stringify(body);
        const response = await fetchFn(`${FLY_API_BASE}${path}`, options);
        if (!response.ok) {
            const text = await response.text();
            const err = new Error(`Fly.io API error (${response.status}): ${text}`);
            err.status = response.status;
            throw err;
        }
        const text = await response.text();
        return text ? JSON.parse(text) : {};
    }

    const certPath = (domain) => `/apps/${FLY_APP_NAME}/certificates/${encodeURIComponent(domain)}`;

    async function provisionSSLCert(domain) {
        try {
            return await flyRequest(`/apps/${FLY_APP_NAME}/certificates/acme`, 'POST', { hostname: domain });
        } catch (err) {
            // Re-verifying after a partial failure must be safe to repeat.
            if (err.status === 409 || err.status === 422 || /already/i.test(err.message)) {
                return getSSLCertStatus(domain);
            }
            throw err;
        }
    }
    const getSSLCertStatus = (domain) => flyRequest(certPath(domain));
    const checkSSLCert = (domain) => flyRequest(`${certPath(domain)}/check`, 'POST');
    const deleteSSLCert = (domain) => flyRequest(certPath(domain), 'DELETE');

    // ── Database ──
    const instructionsFor = (domain, subdomain, token) => ({
        cnameTarget: `${subdomain}.${BASE_DOMAIN}`,
        txtRecord: `_vibebuilder.${domain}`,
        txtValue: token,
        apexRecords: { a: trafficA, aaaa: trafficAAAA },
    });

    async function ownedActiveDeployment(deploymentId, userId) {
        const { data, error } = await supabase
            .from('deployments')
            .select('id, subdomain')
            .eq('id', deploymentId)
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle();
        if (error || !data) throw new Error('Deployment not found or not owned by user');
        return data;
    }

    /** Clients may send either the deployment id or the project id (the website sends the latter). */
    async function resolveDeploymentId(idOrProjectId, userId) {
        const { data: byId } = await supabase
            .from('deployments').select('id').eq('id', idOrProjectId).eq('user_id', userId).maybeSingle();
        if (byId) return byId.id;
        const { data: byProject } = await supabase
            .from('deployments').select('id').eq('project_id', idOrProjectId).eq('user_id', userId).eq('status', 'active').maybeSingle();
        return byProject ? byProject.id : idOrProjectId; // unknown: downstream reports "not found"
    }

    async function addDomain(deploymentId, userId, domain) {
        const cleanDomain = normalizeDomain(domain);
        const deployment = await ownedActiveDeployment(deploymentId, userId);

        const { data: mine } = await supabase
            .from('custom_domains').select('*').eq('deployment_id', deploymentId).maybeSingle();
        if (mine) {
            if (mine.domain === cleanDomain) {
                return { ...mine, ...instructionsFor(mine.domain, deployment.subdomain, mine.verification_token) };
            }
            throw new Error('This app already has a custom domain. Remove it before adding another');
        }

        const { data: existing } = await supabase
            .from('custom_domains').select('id, verification_status, updated_at').eq('domain', cleanDomain).maybeSingle();
        if (existing) {
            const stale = existing.verification_status !== 'active'
                && now() - new Date(existing.updated_at).getTime() > STALE_CLAIM_MS;
            if (!stale) throw new Error('Domain is already registered');
            // An unverified claim nobody completed must not lock the real owner out.
            await supabase.from('custom_domains').delete().eq('id', existing.id);
        }

        const token = generateVerificationToken();
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
        if (error) {
            if (error.code === '23505') throw new Error('Domain is already registered');
            throw error;
        }
        return { ...data, ...instructionsFor(cleanDomain, deployment.subdomain, token) };
    }

    // Best effort: a proxy problem must never break verifying or removing a domain.
    async function announce(event) {
        if (typeof onDomainChange !== 'function') return;
        try { await onDomainChange(event); } catch { /* the next verify repairs it */ }
    }

    async function verifyDomain(deploymentId, userId) {
        const { data: record, error } = await supabase
            .from('custom_domains')
            .select('*, deployments!inner(subdomain)')
            .eq('deployment_id', deploymentId)
            .eq('user_id', userId)
            .maybeSingle();
        if (error || !record) throw new Error('Domain record not found');

        const touch = (fields) => supabase
            .from('custom_domains')
            .update({ last_checked_at: new Date(now()).toISOString(), ...fields })
            .eq('id', record.id);

        if (record.verification_status === 'active') {
            await announce({ subdomain: record.deployments?.subdomain, domain: record.domain });
            return { status: 'active', domain: record.domain, message: 'Domain is live' };
        }

        const subdomain = record.deployments.subdomain;
        const [cnameOk, addressOk, txtOk] = await Promise.all([
            verifyCNAME(record.domain, subdomain),
            verifyAddressRecords(record.domain),
            verifyTXTToken(record.domain, record.verification_token),
        ]);

        if (!cnameOk && !addressOk && !txtOk) {
            await touch({ verification_status: 'pending' });
            return {
                status: 'pending',
                message: 'DNS records not found yet. They can take a few minutes to spread.',
                cnameExpected: `${subdomain}.${BASE_DOMAIN}`,
                apexExpected: { a: trafficA, aaaa: trafficAAAA },
                txtExpected: record.verification_token,
                cnameFound: cnameOk,
                addressFound: addressOk,
                txtFound: txtOk,
            };
        }

        // Ownership proven: request (or re-check) the certificate. Both calls are idempotent.
        await provisionSSLCert(record.domain);
        try { await checkSSLCert(record.domain); } catch { /* status read below decides */ }
        const cert = await getSSLCertStatus(record.domain);

        if (isCertReady(cert, now())) {
            await touch({ verification_status: 'active', ssl_certificate_id: record.domain, updated_at: new Date(now()).toISOString() });
            await announce({ subdomain: record.deployments?.subdomain, domain: record.domain });
            return { status: 'active', domain: record.domain, message: 'Domain verified and certificate issued' };
        }

        await touch({ verification_status: 'ssl_provisioning', ssl_certificate_id: record.domain });
        const pointsHere = cnameOk || addressOk;
        return {
            status: 'ssl_provisioning',
            message: pointsHere
                ? 'DNS verified. Issuing the certificate, which usually takes a minute or two.'
                : 'Ownership verified, but the domain does not point at VibeBuild yet. Add the CNAME (or A and AAAA) records so the certificate can be issued.',
            flyStatus: cert.status ?? null,
        };
    }

    async function getDomainStatus(deploymentId, userId) {
        const { data, error } = await supabase
            .from('custom_domains')
            .select('*, deployments!inner(subdomain)')
            .eq('deployment_id', deploymentId)
            .eq('user_id', userId)
            .maybeSingle();
        if (error || !data) return null;
        return {
            id: data.id,
            domain: data.domain,
            status: data.verification_status,
            ...instructionsFor(data.domain, data.deployments.subdomain, data.verification_token),
            sslCertificateId: data.ssl_certificate_id,
            lastCheckedAt: data.last_checked_at,
            createdAt: data.created_at,
        };
    }

    async function removeDomain(deploymentId, userId) {
        const { data: record, error } = await supabase
            .from('custom_domains')
            .select('domain, ssl_certificate_id, deployments!inner(subdomain)')
            .eq('deployment_id', deploymentId)
            .eq('user_id', userId)
            .maybeSingle();
        if (error || !record) throw new Error('Domain record not found');

        if (record.ssl_certificate_id) {
            try {
                await deleteSSLCert(record.domain);
            } catch (err) {
                console.warn(`Failed to remove certificate for ${record.domain}:`, err.message);
            }
        }
        await supabase.from('custom_domains').delete().eq('deployment_id', deploymentId).eq('user_id', userId);
        await announce({ subdomain: record.deployments?.subdomain, domain: null });
        return { removed: true, domain: record.domain };
    }

    async function getActiveDomainMap() {
        const { data, error } = await supabase
            .from('custom_domains')
            .select('domain, deployments!inner(subdomain)')
            .eq('verification_status', 'active');
        if (error || !data) return [];
        return data.map((d) => ({ domain: d.domain, subdomain: d.deployments.subdomain }));
    }

    return {
        verifyCNAME, verifyAddressRecords, verifyTXTToken,
        provisionSSLCert, getSSLCertStatus, checkSSLCert, deleteSSLCert,
        resolveDeploymentId, addDomain, verifyDomain, getDomainStatus, removeDomain, getActiveDomainMap,
    };
}

// ─── Default instance used by the routes ──────────────────────────────

const proxyAdmin = createProxyAdmin({ baseUrl: process.env.PROXY_ADMIN_URL, token: process.env.PROXY_ADMIN_TOKEN });
const service = createDomainService({ onDomainChange: (event) => syncCustomDomain(proxyAdmin, event) });
export const {
    verifyCNAME, verifyAddressRecords, verifyTXTToken,
    provisionSSLCert, getSSLCertStatus, checkSSLCert, deleteSSLCert,
    resolveDeploymentId, addDomain, verifyDomain, getDomainStatus, removeDomain, getActiveDomainMap,
} = service;
