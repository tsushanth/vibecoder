import express from 'express';
import twilio from 'twilio';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const API = process.env.VIBEBUILD_API_URL || 'https://vibecoder-api.fly.dev';
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+17752788677';
const WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

const activeBuilds = new Map();  // phone -> { prompt, startTime }
const linkedUsers = new Map();   // phone -> { userId, displayName, tier }
const pendingBuilds = new Map(); // phone -> prompt

const twilioClient = twilio(ACCOUNT_SID, AUTH_TOKEN);

// TwiML response helper — guaranteed delivery, no extra API call
function twimlReply(res, message) {
  res.set('Content-Type', 'text/xml');
  res.send(`<Response><Message>${message}</Message></Response>`);
}

// Twilio REST API — for async messages (build complete, etc.)
async function sms(to, body, channel = 'sms') {
  const from = channel === 'whatsapp' ? WHATSAPP_NUMBER : FROM_NUMBER;
  const toAddr = channel === 'whatsapp' && !to.startsWith('whatsapp:') ? `whatsapp:${to}` : to;
  try {
    await twilioClient.messages.create({ from, to: toAddr, body });
    console.log(`[${channel}] Sent to ${to}`);
  } catch (e) {
    console.error(`[${channel}] Failed to ${to}: ${e.message}`);
  }
}

async function getLinkedProfile(phone) {
  try {
    const res = await fetch(`${API}/api/telegram/user/${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (data.linked) {
      const profile = { userId: data.userId, displayName: data.displayName, tier: data.subscriptionTier || 'free' };
      linkedUsers.set(phone, profile);
      return profile;
    }
  } catch {}
  return null;
}

// Long-running build — runs after HTTP response already sent
async function runBuild(phone, prompt, userId, channel = 'sms') {
  const startTime = Date.now();
  activeBuilds.set(phone, { prompt, startTime, channel });
  try {
    const res = await fetch(`${API}/api/projects/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, userId, stream: false, source: 'sms' }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    activeBuilds.delete(phone);

    if (data.projectId) {
      const previewUrl = `https://vibebuild.cc/project/${data.projectId}`;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      await sms(phone,
        `✅ Done! (${elapsed}s)\n` +
        `"${prompt.substring(0, 60)}${prompt.length > 60 ? '...' : ''}"\n\n` +
        `🔗 ${previewUrl}\n\n` +
        `Build more at vibebuild.cc`,
        channel
      );
    } else {
      throw new Error(data.error || 'No project ID returned');
    }
  } catch (e) {
    activeBuilds.delete(phone);
    console.error(`[build] ${phone}: ${e.message}`);
    await sms(phone, `❌ Build failed. ${e.message.includes('timeout') ? 'Timed out — try a simpler prompt.' : 'Try again!'}`, channel);
  }
}

// ─── Shared inbound handler ───
async function handleInbound(req, res, channel) {
  // WhatsApp From looks like "whatsapp:+14251234567" — normalize to plain phone
  const rawFrom = req.body.From || '';
  const phone = rawFrom.replace('whatsapp:', '');
  const text = (req.body.Body || '').trim();

  if (!phone || !text) return twimlReply(res, '');

  console.log(`[${channel}] From ${phone}: "${text.substring(0, 80)}"`);

  // 6-char hex = link code
  if (/^[A-Fa-f0-9]{6}$/.test(text)) {
    try {
      const r = await fetch(`${API}/api/telegram/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: text.toUpperCase(), telegramId: phone, telegramUsername: null, telegramName: phone }),
      });
      const result = await r.json();
      if (result.success) {
        const profile = { userId: result.userId, displayName: result.displayName || 'Builder', tier: 'free' };
        linkedUsers.set(phone, profile);
        const pending = pendingBuilds.get(phone);
        pendingBuilds.delete(phone);
        if (pending) {
          twimlReply(res, `✅ Linked! Welcome ${profile.displayName}! Starting your build now...`);
          runBuild(phone, pending, profile.userId, channel);
        } else {
          twimlReply(res, `✅ Linked! Welcome ${profile.displayName}! Text me what you want to build.`);
        }
      } else {
        twimlReply(res, `❌ Invalid or expired code. Visit vibebuild.cc/connect?tg_id=${encodeURIComponent(phone)} to get a new one.`);
      }
    } catch {
      twimlReply(res, `⚠️ Could not verify code. Try again.`);
    }
    return;
  }

  const upper = text.toUpperCase();
  if (upper === 'STOP' || upper === 'CANCEL') return twimlReply(res, '');

  if (upper === 'HELP' || upper === 'STATUS') {
    const active = activeBuilds.get(phone);
    return active
      ? twimlReply(res, `⏳ Building (${((Date.now() - active.startTime) / 1000).toFixed(0)}s): "${active.prompt.substring(0, 50)}..."`)
      : twimlReply(res, `⚡ VibeBuild\n\nText me what you want to build!\nExample: a todo app with dark mode`);
  }

  if (activeBuilds.has(phone)) {
    return twimlReply(res, `⏳ Still building your last app. Text HELP to check status.`);
  }

  const profile = linkedUsers.get(phone) || await getLinkedProfile(phone);

  if (!profile) {
    pendingBuilds.set(phone, text);
    return twimlReply(res,
      `👋 Link your account first:\n\n` +
      `vibebuild.cc/connect?tg_id=${encodeURIComponent(phone)}\n\n` +
      `Sign in, get the 6-letter code, and text it back. Your build starts automatically!`
    );
  }

  twimlReply(res, `⚡ Building: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"\n\nI'll text you when it's ready (~30s)!`);
  runBuild(phone, text, profile.userId, channel);
}

// ─── Routes ───
app.post('/sms/inbound', (req, res) => handleInbound(req, res, 'sms'));
app.post('/whatsapp/inbound', (req, res) => handleInbound(req, res, 'whatsapp'));

app.get('/health', (_, res) => res.json({ healthy: true, uptime: process.uptime() }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`VibeBuild SMS bot running on port ${PORT}`));
