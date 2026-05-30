/**
 * VibeBuild - Build Monitor Service
 *
 * Runs every 30 minutes. Finds projects stuck in "building" for >15 min,
 * retries them up to 3 times via the worker, sends push notifications on
 * completion/failure, and keeps the system healthy.
 */

import http from 'http';
import http2 from 'http2';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://owvvrljdfnhntwedepkl.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WORKER_URL = process.env.WORKER_URL || 'http://vibebuild-nginx:3456';
const WORKER_SECRET = process.env.WORKER_SECRET || 'vibecoder-worker-secret-2024';
const DEPLOY_URL = process.env.DEPLOY_SERVER_URL || 'https://vibecoder-deploy.fly.dev';
const MAX_RETRIES = 3;
const STALE_MINUTES = 15;
const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// APNs config
const APNS_TEAM_ID = process.env.APNS_TEAM_ID || '7RS696YC75';
const APNS_KEY_ID = process.env.APNS_KEY_ID || 'KUXKM8UC3P';
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'com.kreativekoala.vibercoder';
const APNS_PRIVATE_KEY = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n');

// FCM config
const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID || 'vibebuild-kk';
const FCM_SERVICE_ACCOUNT = process.env.FCM_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON)
    : null;

// ============================================
// APNs
// ============================================
let apnsJWT = null, apnsJWTIssuedAt = 0;

function getAPNsJWT() {
    const now = Math.floor(Date.now() / 1000);
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

async function sendAPNsPush(token, title, body) {
    if (!token || !APNS_PRIVATE_KEY) return;
    const jwt = getAPNsJWT();
    if (!jwt) return;
    return new Promise((resolve) => {
        try {
            const client = http2.connect('https://api.push.apple.com');
            client.on('error', () => resolve());
            const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default', badge: 1 } });
            const req = client.request({
                ':method': 'POST', ':path': `/3/device/${token}`,
                ':scheme': 'https', ':authority': 'api.push.apple.com',
                'authorization': `bearer ${jwt}`, 'apns-topic': APNS_BUNDLE_ID,
                'apns-push-type': 'alert', 'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload)
            });
            req.write(payload);
            req.end();
            req.on('response', (headers) => {
                if (headers[':status'] === 200) console.log(`[APNs] Sent to ${token.substring(0, 8)}...`);
                client.close();
                resolve();
            });
            req.on('error', () => { client.close(); resolve(); });
        } catch { resolve(); }
    });
}

// ============================================
// FCM
// ============================================
let fcmToken = null, fcmTokenExpiresAt = 0;

async function getFCMToken() {
    if (!FCM_SERVICE_ACCOUNT) return null;
    const now = Date.now();
    if (fcmToken && now < fcmTokenExpiresAt - 60000) return fcmToken;
    const iat = Math.floor(now / 1000), exp = iat + 3600;
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        iss: FCM_SERVICE_ACCOUNT.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token', iat, exp
    })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    const sig = sign.sign(FCM_SERVICE_ACCOUNT.private_key).toString('base64url');
    const jwt = `${signingInput}.${sig}`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    if (!res.ok) return null;
    const data = await res.json();
    fcmToken = data.access_token;
    fcmTokenExpiresAt = now + data.expires_in * 1000;
    return fcmToken;
}

async function sendFCMPush(token, title, body) {
    if (!token || !FCM_SERVICE_ACCOUNT) return;
    const accessToken = await getFCMToken();
    if (!accessToken) return;
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ message: { token, notification: { title, body }, android: { priority: 'high' } } })
    });
    if (res.ok) console.log(`[FCM] Sent to ${token.substring(0, 8)}...`);
}

// ============================================
// Supabase helpers
// ============================================
async function supabaseFetch(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        ...options,
        headers: {
            'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json', ...(options.headers || {})
        }
    });
    if (res.headers.get('content-type')?.includes('json')) return res.json();
    return res.text();
}

async function getStaleBuilds() {
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
    return supabaseFetch(
        `/projects?status=eq.building&updated_at=lt.${cutoff}&select=id,title,creator_id,initial_prompt,retry_count&order=updated_at.asc&limit=20`
    );
}

async function getUserPushTokens(userId) {
    // iOS: apns_token from push_tokens
    const iosData = await supabaseFetch(`/push_tokens?user_id=eq.${userId}&select=apns_token`);
    // Android: fcm_token from users table
    const userData = await supabaseFetch(`/users?user_id=eq.${userId}&select=fcm_token&limit=1`);

    const tokens = [];
    if (iosData?.[0]?.apns_token) tokens.push({ token: iosData[0].apns_token, platform: 'ios' });
    if (userData?.[0]?.fcm_token) tokens.push({ token: userData[0].fcm_token, platform: 'android' });
    return tokens;
}

async function markFailed(projectId) {
    await supabaseFetch(`/projects?id=eq.${projectId}`, {
        method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'failed' })
    });
}

async function updateProject(projectId, bundle, previewUrl) {
    const update = { bundle, status: 'ready' };
    if (previewUrl) update.preview_url = previewUrl;
    await supabaseFetch(`/projects?id=eq.${projectId}`, {
        method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(update)
    });
}

async function incrementRetryCount(projectId, retryCount) {
    // retry_count column may not exist yet, ignore errors
    await supabaseFetch(`/projects?id=eq.${projectId}`, {
        method: 'PATCH', headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ retry_count: (retryCount || 0) + 1, updated_at: new Date().toISOString() })
    }).catch(() => {});
}

// ============================================
// Build via worker (SSE streaming)
// ============================================
function buildProjectHTTP(project) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            prompt: project.initial_prompt,
            userId: project.creator_id,
            framework: 'react',
            stream: true
        });

        const url = new URL(`${WORKER_URL}/generate`);
        const req = http.request({
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'x-worker-secret': WORKER_SECRET
            }
        }, (res) => {
            if (res.statusCode === 429) {
                res.resume();
                return resolve({ retry429: true });
            }
            if (res.statusCode !== 200) {
                let errBody = '';
                res.on('data', d => { errBody += d; });
                res.on('end', () => reject(new Error(`Worker ${res.statusCode}: ${errBody}`)));
                return;
            }

            let buffer = '', bundle = null, quality = null;

            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === 'result' && event.success) {
                            bundle = event.bundle;
                            quality = event.quality;
                        } else if (event.type === 'error') {
                            reject(new Error(`Build error: ${event.error}`));
                        }
                    } catch {}
                }
            });

            res.on('end', () => {
                if (bundle) resolve({ bundle, quality });
                else reject(new Error('No bundle received'));
            });
            res.on('error', reject);
        });

        req.on('error', reject);
        req.setTimeout(720000, () => { req.destroy(); reject(new Error('Build timeout (12min)')); });
        req.write(body);
        req.end();
    });
}

async function deployPreview(projectId, bundle) {
    try {
        const subdomain = `preview-${projectId.substring(0, 12)}`;
        const res = await fetch(`${DEPLOY_URL}/deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subdomain, bundle })
        });
        if (res.ok) return `https://${subdomain}.vibecoder.app`;
    } catch {}
    return null;
}

// ============================================
// Process a single stale project
// ============================================
async function processProject(project) {
    const id = project.id.substring(0, 8);
    const retryCount = project.retry_count || 0;

    if (retryCount >= MAX_RETRIES) {
        console.log(`[${id}] Max retries (${MAX_RETRIES}) reached, marking failed`);
        await markFailed(project.id);
        const tokens = await getUserPushTokens(project.creator_id);
        const shortTitle = project.title?.length > 40 ? project.title.substring(0, 40) + '...' : (project.title || 'Your app');
        for (const { token, platform } of tokens) {
            if (platform === 'ios') await sendAPNsPush(token, 'Build Failed', `"${shortTitle}" couldn't be built. Please try again.`);
            else if (platform === 'android') await sendFCMPush(token, 'Build Failed', `"${shortTitle}" couldn't be built. Please try again.`);
        }
        return { id: project.id, success: false, reason: 'max_retries' };
    }

    console.log(`[${id}] Retrying build (attempt ${retryCount + 1}/${MAX_RETRIES}): "${project.title}"`);
    await incrementRetryCount(project.id, retryCount);

    // Try up to 5 times for 429
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const result = await buildProjectHTTP(project);

            if (result.retry429) {
                const wait = 30 + attempt * 15;
                console.log(`[${id}] Worker busy, waiting ${wait}s...`);
                await new Promise(r => setTimeout(r, wait * 1000));
                continue;
            }

            const { bundle, quality } = result;
            const previewUrl = await deployPreview(project.id, bundle);
            await updateProject(project.id, bundle, previewUrl);
            console.log(`[${id}] Build succeeded! Quality: ${quality}, Preview: ${previewUrl}`);

            // Notify user
            const tokens = await getUserPushTokens(project.creator_id);
            const shortTitle = project.title?.length > 40 ? project.title.substring(0, 40) + '...' : (project.title || 'Your app');
            for (const { token, platform } of tokens) {
                if (platform === 'ios') await sendAPNsPush(token, 'Project Ready!', `"${shortTitle}" has been built. Tap to view!`);
                else if (platform === 'android') await sendFCMPush(token, 'Project Ready!', `"${shortTitle}" has been built. Tap to view!`);
            }

            return { id: project.id, success: true };
        } catch (err) {
            console.error(`[${id}] Attempt ${attempt + 1} failed: ${err.message}`);
            if (attempt === 4) {
                await markFailed(project.id);
                return { id: project.id, success: false, reason: err.message };
            }
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

// ============================================
// Main monitor loop
// ============================================
async function runMonitor() {
    console.log(`\n[monitor] Checking for stale builds (>${STALE_MINUTES}min)...`);
    try {
        const staleProjects = await getStaleBuilds();
        if (!Array.isArray(staleProjects) || staleProjects.length === 0) {
            console.log('[monitor] No stale builds found.');
            return;
        }

        console.log(`[monitor] Found ${staleProjects.length} stale build(s)`);

        // Process 2 at a time
        for (let i = 0; i < staleProjects.length; i += 2) {
            const batch = staleProjects.slice(i, i + 2);
            await Promise.all(batch.map(p => processProject(p)));
        }

        console.log('[monitor] Done.');
    } catch (err) {
        console.error('[monitor] Error:', err.message);
    }
}

// ============================================
// HTTP server (health check + manual trigger)
// ============================================
const PORT = process.env.PORT || 3466;

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        return res.end(JSON.stringify({ healthy: true, uptime: process.uptime() }));
    }
    if (req.method === 'POST' && req.url === '/trigger') {
        const secret = req.headers['x-worker-secret'];
        if (secret !== WORKER_SECRET) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }
        runMonitor().catch(console.error);
        res.end(JSON.stringify({ triggered: true }));
        return;
    }
    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`VibeBuild Monitor running on port ${PORT}`);
    console.log(`Worker: ${WORKER_URL}`);
    // Run immediately on start, then every 30 minutes
    runMonitor().catch(console.error);
    setInterval(() => runMonitor().catch(console.error), POLL_INTERVAL_MS);
});
