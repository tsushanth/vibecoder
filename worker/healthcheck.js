/**
 * VibeCoder Worker Health Check
 * Asks Claude "What is the capital of France?" and emails if answer doesn't contain "Paris"
 * Run via cron every 15 minutes.
 */

import { execSync } from 'child_process';
import nodemailer from 'nodemailer';

const ALERT_EMAIL = 'sushanthtiruvaipati@gmail.com';
const FROM_EMAIL = 'puzzleverseai@gmail.com';
const EMAIL_PASS = 'duoo ukes bjkx nanj';

async function sendAlert(subject, body) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: FROM_EMAIL, pass: EMAIL_PASS }
    });
    await transporter.sendMail({
        from: `"VibeBuild Worker Monitor" <${FROM_EMAIL}>`,
        to: ALERT_EMAIL,
        subject,
        html: `<pre style="font-family:monospace">${body}</pre>`
    });
    console.log(`[healthcheck] Alert sent: ${subject}`);
}

async function runHealthCheck() {
    const timestamp = new Date().toISOString();
    console.log(`[healthcheck] Running at ${timestamp}`);

    let response = '';
    try {
        response = execSync(
            'su vibecoder -c \'/usr/bin/claude -p "What is the capital of France? Answer in one word only."\'',
            { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        console.log(`[healthcheck] Claude responded: ${response}`);
    } catch (err) {
        const msg = `Claude CLI failed to respond.\n\nError: ${err.message}\nStderr: ${err.stderr || ''}`;
        console.error(`[healthcheck] ${msg}`);
        await sendAlert('🚨 VibeBuild Worker: Claude CLI not responding', msg);
        return;
    }

    if (response.trim().toLowerCase() !== 'paris') {
        const msg = `Claude gave an unexpected answer to the health check.\n\nQuestion: "What is the capital of France?"\nExpected: contains "Paris"\nActual response: "${response}"\n\nTimestamp: ${timestamp}`;
        console.error(`[healthcheck] Unexpected response: ${response}`);
        await sendAlert('⚠️ VibeBuild Worker: Claude gave wrong answer', msg);
    } else {
        console.log(`[healthcheck] OK — Claude correctly answered with Paris`);
    }
}

runHealthCheck().catch(async (err) => {
    console.error('[healthcheck] Unhandled error:', err);
    try {
        await sendAlert('🚨 VibeBuild Worker: Health check script crashed', err.message);
    } catch {}
});
