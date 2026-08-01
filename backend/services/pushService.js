import crypto from 'crypto';
import http2 from 'http2';
import nodemailer from 'nodemailer';
import { supabase } from '../config/database.js';

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
        const upsellBlock = isAppReady ? `
            <div style="margin-top:24px;padding:16px;background:#f5f3ff;border-radius:12px;border-left:4px solid #6366f1">
                <p style="margin:0 0 8px;font-weight:700;color:#4f46e5">⚡ Go Pro — Never Wait Again</p>
                <p style="margin:0 0 12px;color:#4b5563;font-size:14px">Free users share builder capacity. Pro users get <strong>priority builds</strong>, faster generation, and unlimited apps — no delays, no failures.</p>
                <a href="https://play.google.com/store/apps/details?id=com.kreativekoala.vibercoder" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Upgrade to Pro →</a>
            </div>` : '';

        await emailTransport.sendMail({
            from: `"VibeBuild" <${EMAIL_USER}>`,
            to,
            subject: title,
            text: `${body}\n\nUpgrade to Pro for priority builds and no delays: https://play.google.com/store/apps/details?id=com.kreativekoala.vibercoder`,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                <img src="https://vibebuild.app/icon.png" width="48" style="margin-bottom:16px" onerror="this.style.display='none'">
                <h2 style="color:#111827;margin:0 0 8px">${title}</h2>
                <p style="color:#4b5563;margin:0 0 20px">${body}</p>
                <a href="https://play.google.com/store/apps/details?id=com.kreativekoala.vibercoder" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Open VibeBuild</a>
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
const FCM_SERVICE_ACCOUNT = (() => {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    try {
        // Cloud Run may inject the secret with literal newlines — sanitize before parsing
        return JSON.parse(raw.replace(/\n/g, '\\n'));
    } catch {
        try { return JSON.parse(raw); } catch { return null; }
    }
})();

let fcmAccessToken = null;
let fcmAccessTokenExpiresAt = 0;

async function getFCMAccessToken() {
    const now = Date.now();
    if (fcmAccessToken && now < fcmAccessTokenExpiresAt - 60000) return fcmAccessToken;
    if (!FCM_SERVICE_ACCOUNT) return null;

    // Create JWT for service account
    const iat = Math.floor(now / 1000);
    const exp = iat + 3600;
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        iss: FCM_SERVICE_ACCOUNT.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat, exp
    })).toString('base64url');

    const signingInput = `${header}.${payload}`;
    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    const signature = sign.sign(FCM_SERVICE_ACCOUNT.private_key).toString('base64url');
    const jwt = `${signingInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });

    if (!res.ok) {
        console.error('[FCM] Failed to get access token:', await res.text());
        return null;
    }

    const data = await res.json();
    fcmAccessToken = data.access_token;
    fcmAccessTokenExpiresAt = now + data.expires_in * 1000;
    return fcmAccessToken;
}

async function sendFCMPush(fcmToken, title, body) {
    if (!fcmToken || !FCM_SERVICE_ACCOUNT) return;
    const accessToken = await getFCMAccessToken();
    if (!accessToken) return;

    const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                message: {
                    token: fcmToken,
                    notification: { title, body },
                    android: { priority: 'high', notification: { sound: 'default' } }
                }
            })
        }
    );

    if (res.ok) {
        console.log(`[FCM] Push sent to ${fcmToken.substring(0, 8)}...`);
    } else {
        const err = await res.text();
        console.error(`[FCM] Push failed: ${res.status} ${err}`);
    }
}

// ============================================
// Unified: send push to a user (queries push_tokens table)
// ============================================
export async function sendPushToUser(userId, title, body, data = {}) {
    let notified = false;

    // iOS: query push_tokens table
    const { data: iosToken } = await supabase
        .from('push_tokens')
        .select('apns_token')
        .eq('user_id', userId)
        .single();

    if (iosToken?.apns_token) {
        await sendAPNsPush(iosToken.apns_token, title, body, data);
        notified = true;
    }

    // Android: query users table for fcm_token + email
    const { data: user } = await supabase
        .from('users')
        .select('fcm_token, email')
        .eq('user_id', userId)
        .single();

    if (user?.fcm_token) {
        await sendFCMPush(user.fcm_token, title, body);
        notified = true;
    }

    // Fall back to email if no push token available
    if (!notified && user?.email) {
        const isAppReady = title.includes('ready') || title.includes('Ready');
        await sendEmail(user.email, title, body, isAppReady);
    }
}

// Legacy: send directly to APNs device token (for backward compat)
export { sendAPNsPush };
