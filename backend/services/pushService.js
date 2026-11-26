import crypto from 'crypto';
import http2 from 'http2';
import nodemailer from 'nodemailer';
import { supabase } from '../config/database.js';
import { allFreeEnabled } from '../lib/allFree.js';
import { appEvents } from '../lib/appEventsInstance.js';
import { reportFailure } from '../lib/failureReporter.js';

// ============================================
// Email fallback (Gmail SMTP)
// ============================================
const EMAIL_USER = process.env.ALERT_EMAIL_USER || 'puzzleverseai@gmail.com';
const EMAIL_PASS = process.env.ALERT_EMAIL_PASS;

const emailTransport = EMAIL_PASS ? nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
}) : null;

async function sendEmail(to, title, body, isAppReady = false) {
    if (!emailTransport || !to) return;
    try {
        // No Pro upsell while VIBEBUILD_ALL_FREE is on (everything is free).
        const upsellBlock = isAppReady && !allFreeEnabled() ? `
            <div style="margin-top:24px;padding:16px;background:#f5f3ff;border-radius:12px;border-left:4px solid #6366f1">
                <p style="margin:0 0 8px;font-weight:700;color:#4f46e5">⚡ Go Pro — Never Wait Again</p>
                <p style="margin:0 0 12px;color:#4b5563;font-size:14px">Free users share builder capacity. Pro users get <strong>priority builds</strong>, faster generation, and unlimited apps — no delays, no failures.</p>
                <a href="https://play.google.com/store/apps/details?id=com.kreativekoala.vibecoder" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Upgrade to Pro →</a>
            </div>` : '';

        await emailTransport.sendMail({
            from: `"VibeBuild" <${EMAIL_USER}>`,
            to,
            subject: title,
            text: allFreeEnabled() ? body : `${body}\n\nUpgrade to Pro for priority builds and no delays: https://play.google.com/store/apps/details?id=com.kreativekoala.vibecoder`,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                <img src="https://vibebuild.app/icon.png" width="48" style="margin-bottom:16px" onerror="this.style.display='none'">
                <h2 style="color:#111827;margin:0 0 8px">${title}</h2>
                <p style="color:#4b5563;margin:0 0 20px">${body}</p>
                <a href="https://play.google.com/store/apps/details?id=com.kreativekoala.vibecoder" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Open VibeBuild</a>
                ${upsellBlock}
                <p style="margin-top:24px;font-size:12px;color:#9ca3af">You're receiving this because you created an app on VibeBuild.</p>
                </div>`
        });
        console.log(`[Email] Sent to ${to}`);
    } catch (e) {
        console.error(`[Email] Failed to ${to}: ${e.message}`);
    }
}

// ============================================
// APNs (iOS Push Notifications)
// ============================================
const APNS_TEAM_ID = process.env.APNS_TEAM_ID || '7RS696YC75';
const APNS_KEY_ID = process.env.APNS_KEY_ID || 'KUXKM8UC3P';
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'com.kreativekoala.vibercoder';
const APNS_PRIVATE_KEY = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n');

let apnsJWT = null;
let apnsJWTIssuedAt = 0;

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

async function sendAPNsPush(deviceToken, title, body, data = {}) {
    if (!deviceToken || !APNS_PRIVATE_KEY) return;
    const token = getAPNsJWT();
    if (!token) return;

    return new Promise((resolve) => {
        try {
            const client = http2.connect('https://api.push.apple.com');
            client.on('error', () => resolve());

            // Custom data is merged at the top level of the APNs payload; the
            // iOS app reads `userInfo[k]` for any key not under `aps`. We use
            // this to carry projectId for tap-to-open deep linking.
            const payloadObj = {
                aps: { alert: { title, body }, sound: 'default', badge: 1 },
                ...data
            };
            const pushPayload = JSON.stringify(payloadObj);

            const req = client.request({
                ':method': 'POST',
                ':path': `/3/device/${deviceToken}`,
                ':scheme': 'https',
                ':authority': 'api.push.apple.com',
                'authorization': `bearer ${token}`,
                'apns-topic': APNS_BUNDLE_ID,
                'apns-push-type': 'alert',
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(pushPayload)
            });

            req.write(pushPayload);
            req.end();

            let responseData = '';
            req.on('data', (chunk) => { responseData += chunk; });
            req.on('response', (headers) => {
                const statusCode = headers[':status'];
                if (statusCode === 200) {
                    console.log(`[APNs] Push sent to ${deviceToken.substring(0, 8)}...`);
                } else {
                    console.error(`[APNs] Push failed: status=${statusCode} body=${responseData}`);
                }
                client.close();
                resolve();
            });

            req.on('error', () => { client.close(); resolve(); });
        } catch (err) {
            console.error('[APNs] Error:', err.message);
            resolve();
        }
    });
}

// ============================================
// FCM (Android Push Notifications)
// ============================================
const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID || 'vibebuild-kk';
// The channel the Android app creates at start (NotificationHelper); without it a background notice lands in FCM's fallback channel.
const ANDROID_CHANNEL_ID = 'generation_complete';

/** The service account from FCM_SERVICE_ACCOUNT_JSON (one line or pretty-printed), or null when unset or unusable. */
export function parseServiceAccount(raw) {
    if (!raw) return null;
    const usable = (v) => (typeof v?.client_email === 'string' && typeof v?.private_key === 'string' ? v : null);
    try {
        return usable(JSON.parse(raw));
    } catch {
        // Some secret stores inject literal newlines inside the private key string
        try { return usable(JSON.parse(raw.replace(/\n/g, '\\n'))); } catch { return null; }
    }
}

/**
 * Sends one Android notice. Returns { outcome: 'sent' | 'failed' | 'unregistered' | 'not_configured', status? }.
 */
export function createFcmSender({ serviceAccount, projectId = FCM_PROJECT_ID, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
    let accessToken = null;
    let expiresAt = 0;

    async function getAccessToken() {
        if (accessToken && now() < expiresAt - 60000) return accessToken;
        // Create JWT for service account
        const iat = Math.floor(now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({
            iss: serviceAccount.client_email,
            scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: 'https://oauth2.googleapis.com/token',
            iat, exp: iat + 3600
        })).toString('base64url');

        const signingInput = `${header}.${payload}`;
        const sign = crypto.createSign('SHA256');
        sign.update(signingInput);
        const signature = sign.sign(serviceAccount.private_key).toString('base64url');

        const res = await fetchFn('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signingInput}.${signature}`,
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) {
            console.error(`[FCM] Failed to get access token: ${res.status}`);
            return null;
        }
        const data = await res.json();
        accessToken = data.access_token;
        expiresAt = now() + data.expires_in * 1000;
        return accessToken;
    }

    return async function send(fcmToken, title, body, data = {}) {
        if (!serviceAccount) return { outcome: 'not_configured' };
        try {
            const token = await getAccessToken();
            if (!token) return { outcome: 'failed' };
            // FCM data values must be strings; empty ones are left out.
            const strings = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
            const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    message: {
                        token: fcmToken,
                        notification: { title, body },
                        data: strings,
                        android: {
                            priority: 'high',
                            // The tag matches the app's own "ready" notice for the same project, so a person sees one, not two.
                            notification: { sound: 'default', channel_id: ANDROID_CHANNEL_ID, ...(strings.projectId && { tag: strings.projectId }) }
                        }
                    }
                }),
                signal: AbortSignal.timeout(10000)
            });
            if (res.ok) return { outcome: 'sent', status: res.status };
            const text = await res.text().catch(() => '');
            // Only the error's own code is read: the app was uninstalled or the token replaced.
            if (res.status === 404 && /UNREGISTERED/.test(text)) return { outcome: 'unregistered', status: res.status };
            console.error(`[FCM] Push failed: ${res.status}`);
            return { outcome: 'failed', status: res.status };
        } catch (e) {
            console.error(`[FCM] Push failed: ${e?.name || 'error'}`);
            return { outcome: 'failed' };
        }
    };
}

// ============================================
// Unified: send push to a user (queries push_tokens table)
// ============================================
const PLATFORMS = new Set(['web', 'android', 'ios']);

export function createPushSender({ client, sendFcm, sendApns, sendMail, events, report }) {
    return async function sendPushToUser(userId, title, body, data = {}) {
        let notified = false;
        const kind = data.kind || 'other';

        // iOS: query push_tokens table
        const { data: iosToken } = await client
            .from('push_tokens')
            .select('apns_token')
            .eq('user_id', userId)
            .single();

        if (iosToken?.apns_token) {
            await sendApns(iosToken.apns_token, title, body, data);
            notified = true;
        }

        // Android: query users table for fcm_token + email
        const { data: user } = await client
            .from('users')
            .select('fcm_token, email, platform')
            .eq('user_id', userId)
            .single();

        const result = user?.fcm_token ? await sendFcm(user.fcm_token, title, body, data) : { outcome: 'no_token' };
        if (result.outcome === 'sent') notified = true;
        if (result.outcome === 'unregistered') {
            // A dead token is forgotten (only if it is still the same one); the app uploads a fresh one at its next start.
            await client.from('users').update({ fcm_token: null }).eq('user_id', userId).eq('fcm_token', user.fcm_token);
        }
        if (result.outcome === 'failed') report('push:fcm_send', new Error('A notification could not be delivered to FCM'), { status: String(result.status || 'none') });

        // What happened to every notice, for people who could have had one on Android: no names, tokens or text.
        if (!iosToken?.apns_token || user?.fcm_token) {
            events.emit('push_result', { userId, props: { push_kind: kind, push_outcome: result.outcome, ...(PLATFORMS.has(user?.platform) && { source: user.platform }) } });
        }

        // Fall back to email if nothing was delivered (does nothing unless ALERT_EMAIL_PASS is set)
        if (!notified && user?.email) {
            const isAppReady = title.includes('ready') || title.includes('Ready');
            await sendMail(user.email, title, body, isAppReady);
        }
        return result.outcome;
    };
}

const serviceAccount = parseServiceAccount(process.env.FCM_SERVICE_ACCOUNT_JSON);
if (process.env.NODE_ENV !== 'test') console.log(`[push] Android notifications ${serviceAccount ? 'configured' : 'NOT configured (FCM_SERVICE_ACCOUNT_JSON unset or unusable)'}`);
if (process.env.FCM_SERVICE_ACCOUNT_JSON && !serviceAccount) reportFailure('push:fcm_config', new Error('FCM_SERVICE_ACCOUNT_JSON is set but is not a usable service account key'));

export const sendPushToUser = createPushSender({
    client: supabase,
    sendFcm: createFcmSender({ serviceAccount }),
    sendApns: sendAPNsPush,
    sendMail: sendEmail,
    events: appEvents,
    report: reportFailure,
});

// Legacy: send directly to APNs device token (for backward compat)
export { sendAPNsPush };
