/**
 * VibeBuild — Email Drip Sequence Script
 *
 * Touch 1 (promo_1): New users 24h+ old who haven't received any email yet
 * Touch 2 (promo_2): Users who got promo_1 3+ days ago, still not subscribed
 * Touch 3 (promo_3): Users who got promo_2 7+ days ago, still not subscribed
 *
 * Usage:
 *   export RESEND_API_KEY=re_xxxx
 *   export SUPABASE_URL=https://owvvrljdfnhntwedepkl.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   npx tsx scripts/send-promo.ts
 *
 * Optional:
 *   DRY_RUN=true   — log without sending
 *   STEP=1|2|3     — only run a specific touch
 */

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname);
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env") });

// ── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === "true";
const ONLY_STEP = process.env.STEP ? parseInt(process.env.STEP) : null;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;

const TOUCH2_DELAY_DAYS = 3;
const TOUCH3_DELAY_DAYS = 7;
const TOUCH1_DELAY_HOURS = 24;

const SENDING_DOMAIN = "send.kreativekoala.llc";
const FROM = `VibeBuild <vibebuild@${SENDING_DOMAIN}>`;
const UPGRADE_URL = "https://play.google.com/store/apps/details?id=com.kreativekoala.vibecoder";

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }
function hoursAgo(n: number) { const d = new Date(); d.setHours(d.getHours() - n); return d.toISOString(); }

function getSupabase() { return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY); }
function getResend() { return new Resend(RESEND_API_KEY); }

// ── User queries ──────────────────────────────────────────────────────────────

interface User { user_id: string; email: string; display_name: string | null; }

async function getTouch1Users(): Promise<User[]> {
  log("Fetching Touch 1 candidates…");
  const supabase = getSupabase();

  const { data: candidates, error } = await supabase
    .from("users")
    .select("user_id, email, display_name")
    .eq("subscription_tier", "free")
    .not("email", "is", null)
    .not("email", "like", "%@example%")
    .lt("created_at", hoursAgo(TOUCH1_DELAY_HOURS));

  if (error) throw new Error(`Query failed: ${error.message}`);
  const all = (candidates ?? []) as User[];

  const ids = all.map((u) => u.user_id);
  if (ids.length === 0) return [];

  const { data: alreadySent } = await supabase
    .from("user_emails").select("user_id").in("user_id", ids);

  const sentIds = new Set((alreadySent ?? []).map((r: any) => r.user_id));
  const users = all.filter((u) => !sentIds.has(u.user_id));
  log(`Touch 1: ${users.length} users (${sentIds.size} already emailed)`);
  return users;
}

async function getTouch2Users(): Promise<User[]> {
  log(`Fetching Touch 2 candidates (promo_1 sent ${TOUCH2_DELAY_DAYS}+ days ago)…`);
  const supabase = getSupabase();

  const { data: t1, error: e1 } = await supabase
    .from("user_emails").select("user_id")
    .eq("template", "promo_1").lt("sent_at", daysAgo(TOUCH2_DELAY_DAYS));
  if (e1) throw new Error(e1.message);

  const t1Ids = (t1 ?? []).map((r: any) => r.user_id);
  if (!t1Ids.length) return [];

  const { data: t2 } = await supabase
    .from("user_emails").select("user_id")
    .eq("template", "promo_2").in("user_id", t1Ids);
  const skip = new Set((t2 ?? []).map((r: any) => r.user_id));
  const eligible = t1Ids.filter((id: string) => !skip.has(id));
  if (!eligible.length) return [];

  const { data, error: e2 } = await supabase
    .from("users").select("user_id, email, display_name")
    .in("user_id", eligible).eq("subscription_tier", "free").not("email", "is", null);
  if (e2) throw new Error(e2.message);

  const users = (data ?? []) as User[];
  log(`Touch 2: ${users.length} users eligible`);
  return users;
}

async function getTouch3Users(): Promise<User[]> {
  log(`Fetching Touch 3 candidates (promo_2 sent ${TOUCH3_DELAY_DAYS}+ days ago)…`);
  const supabase = getSupabase();

  const { data: t2, error: e1 } = await supabase
    .from("user_emails").select("user_id")
    .eq("template", "promo_2").lt("sent_at", daysAgo(TOUCH3_DELAY_DAYS));
  if (e1) throw new Error(e1.message);

  const t2Ids = (t2 ?? []).map((r: any) => r.user_id);
  if (!t2Ids.length) return [];

  const { data: t3 } = await supabase
    .from("user_emails").select("user_id")
    .eq("template", "promo_3").in("user_id", t2Ids);
  const skip = new Set((t3 ?? []).map((r: any) => r.user_id));
  const eligible = t2Ids.filter((id: string) => !skip.has(id));
  if (!eligible.length) return [];

  const { data, error: e2 } = await supabase
    .from("users").select("user_id, email, display_name")
    .in("user_id", eligible).eq("subscription_tier", "free").not("email", "is", null);
  if (e2) throw new Error(e2.message);

  const users = (data ?? []) as User[];
  log(`Touch 3: ${users.length} users eligible`);
  return users;
}

async function recordSend(userId: string, email: string, template: string) {
  await getSupabase().from("user_emails").insert({
    user_id: userId, email, template,
    sent_at: new Date().toISOString(), status: "sent",
  });
}

// ── Email templates ───────────────────────────────────────────────────────────

function firstName(name: string | null) { return name?.split(" ")[0] ?? "there"; }

function buildTouch1Html(name: string | null) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f7;margin:0;padding:0;color:#1d1d1f}
.wrapper{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.header{background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);padding:40px 32px;text-align:center}
.header h1{color:#fff;margin:0;font-size:26px;font-weight:700}
.header p{color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px}
.body{padding:32px}
.body p{font-size:15px;line-height:1.6;margin:0 0 16px;color:#3a3a3c}
.cta{display:block;background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);color:#fff!important;text-decoration:none;text-align:center;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:700;margin:24px 0}
.features{background:#f9f9fb;border-radius:12px;padding:20px;margin:20px 0}
.feature{display:flex;align-items:flex-start;margin-bottom:14px}
.feature:last-child{margin-bottom:0}
.feature-icon{font-size:20px;margin-right:12px;flex-shrink:0}
.feature-text{font-size:14px;color:#3a3a3c;line-height:1.5}
.fine-print{font-size:12px;color:#8e8e93;line-height:1.5;margin-top:24px}
.footer{background:#f5f5f7;padding:20px 32px;text-align:center;font-size:12px;color:#8e8e93}
</style></head>
<body><div class="wrapper">
<div class="header"><h1>⚡ VibeBuild</h1><p>Build apps with AI — upgrade to unlock everything</p></div>
<div class="body">
<p>Hey ${firstName(name)},</p>
<p>Thanks for trying VibeBuild! You're currently on the free tier — here's what you're missing with Pro:</p>
<div class="features">
  <div class="feature"><span class="feature-icon">🚀</span><div class="feature-text"><strong>Unlimited projects</strong> — build as many apps as you want</div></div>
  <div class="feature"><span class="feature-icon">✨</span><div class="feature-text"><strong>Unlimited AI tweaks</strong> — no daily limits, iterate freely</div></div>
  <div class="feature"><span class="feature-icon">📦</span><div class="feature-text"><strong>APK exports</strong> — download and publish your apps</div></div>
  <div class="feature"><span class="feature-icon">⚡</span><div class="feature-text"><strong>Priority generation</strong> — faster builds, no queue</div></div>
</div>
<a class="cta" href="${UPGRADE_URL}">Upgrade to VibeBuild Pro →</a>
<p class="fine-print">Open VibeBuild and tap Upgrade to get started. Available on Android.</p>
</div>
<div class="footer">© VibeBuild · You're receiving this because you have a VibeBuild account.</div>
</div></body></html>`;
}

function buildTouch2Html(name: string | null) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f7;margin:0;padding:0;color:#1d1d1f}
.wrapper{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.header{background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);padding:40px 32px;text-align:center}
.header h1{color:#fff;margin:0;font-size:26px;font-weight:700}
.header p{color:rgba(255,255,255,.85);margin:8px 0 0;font-size:15px}
.body{padding:32px}
.body p{font-size:15px;line-height:1.6;margin:0 0 16px;color:#3a3a3c}
.highlight{background:#f0effe;border-left:4px solid #7C3AED;padding:16px 20px;border-radius:0 12px 12px 0;margin:20px 0}
.cta{display:block;background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);color:#fff!important;text-decoration:none;text-align:center;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:700;margin:24px 0}
.fine-print{font-size:12px;color:#8e8e93;line-height:1.5;margin-top:24px}
.footer{background:#f5f5f7;padding:20px 32px;text-align:center;font-size:12px;color:#8e8e93}
</style></head>
<body><div class="wrapper">
<div class="header"><h1>⚡ VibeBuild</h1><p>Still building on the free tier?</p></div>
<div class="body">
<p>Hey ${firstName(name)},</p>
<p>We noticed you haven't upgraded to VibeBuild Pro yet. A quick reminder of what you're leaving on the table:</p>
<div class="highlight">
  <p style="margin:0;color:#4F46E5;font-weight:600;font-size:15px">With Pro, you can build and export unlimited apps — no daily caps, no limits. Just describe what you want and ship it.</p>
</div>
<p>VibeBuild Pro users are shipping real apps to the Play Store in hours, not months. You have the tool — just unlock it.</p>
<a class="cta" href="${UPGRADE_URL}">Upgrade to Pro →</a>
<p class="fine-print">Open VibeBuild and tap Upgrade. Available on Android.</p>
</div>
<div class="footer">© VibeBuild · You're receiving this because you have a VibeBuild account.</div>
</div></body></html>`;
}

function buildTouch3Html(name: string | null) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f7;margin:0;padding:0;color:#1d1d1f}
.wrapper{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.header{background:linear-gradient(135deg,#FF6B35 0%,#7C3AED 100%);padding:40px 32px;text-align:center}
.header h1{color:#fff;margin:0;font-size:26px;font-weight:700}
.header p{color:rgba(255,255,255,.9);margin:8px 0 0;font-size:15px}
.body{padding:32px}
.body p{font-size:15px;line-height:1.6;margin:0 0 16px;color:#3a3a3c}
.cta{display:block;background:linear-gradient(135deg,#FF6B35 0%,#7C3AED 100%);color:#fff!important;text-decoration:none;text-align:center;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:700;margin:24px 0}
.fine-print{font-size:12px;color:#8e8e93;line-height:1.5;margin-top:24px}
.footer{background:#f5f5f7;padding:20px 32px;text-align:center;font-size:12px;color:#8e8e93}
</style></head>
<body><div class="wrapper">
<div class="header"><h1>⚡ VibeBuild</h1><p>Last message — just checking in one final time</p></div>
<div class="body">
<p>Hey ${firstName(name)},</p>
<p>This is our last email about upgrading. If VibeBuild Pro isn't right for you right now, no worries at all.</p>
<p>But if you've been on the fence — the free tier caps you at ${3} generations per day and ${3} tweaks per project. Pro removes every limit so you can actually build and ship what you're imagining.</p>
<a class="cta" href="${UPGRADE_URL}">Take Another Look at Pro →</a>
<p style="font-size:13px;color:#8e8e93">This is the last email we'll send about upgrading. You'll still get important account emails.</p>
</div>
<div class="footer">© VibeBuild · You're receiving this because you have a VibeBuild account.</div>
</div></body></html>`;
}

// ── Send batch ────────────────────────────────────────────────────────────────

async function sendBatch(
  users: User[],
  template: "promo_1" | "promo_2" | "promo_3",
  buildHtml: (name: string | null) => string,
  subject: string
) {
  if (!users.length) { log(`No users for ${template}. Skipping.`); return; }
  log(`Sending ${template} to ${users.length} users${DRY_RUN ? " (DRY RUN)" : ""}…`);

  const resend = getResend();
  let sent = 0, failed = 0;

  for (const user of users) {
    if (!user.email) continue;
    if (DRY_RUN) { log(`[DRY RUN] Would send ${template} → ${user.email}`); sent++; continue; }

    try {
      await resend.emails.send({ from: FROM, to: user.email, subject, html: buildHtml(user.display_name) });
      await recordSend(user.user_id, user.email, template);
      sent++;
      log(`Sent ${template} → ${user.email}`);
    } catch (err: any) {
      failed++;
      log(`FAILED ${template} → ${user.email}: ${err?.message}`);
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  log(`${template} done. Sent: ${sent} | Failed: ${failed}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!RESEND_API_KEY) { console.error("ERROR: RESEND_API_KEY required"); process.exit(1); }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }

  log("=== VibeBuild Email Drip Sequence ===");
  log(`Dry run: ${DRY_RUN} | Step: ${ONLY_STEP ?? "all"}`);
  log("");

  if (!ONLY_STEP || ONLY_STEP === 1) {
    log("--- Touch 1: Welcome to Pro ---");
    await sendBatch(await getTouch1Users(), "promo_1", buildTouch1Html,
      "⚡ You're missing VibeBuild Pro — here's what you get");
    log("");
  }

  if (!ONLY_STEP || ONLY_STEP === 2) {
    log("--- Touch 2: Feature reminder ---");
    await sendBatch(await getTouch2Users(), "promo_2", buildTouch2Html,
      "Still building for free? Here's what Pro unlocks");
    log("");
  }

  if (!ONLY_STEP || ONLY_STEP === 3) {
    log("--- Touch 3: Last chance ---");
    await sendBatch(await getTouch3Users(), "promo_3", buildTouch3Html,
      "⚡ Final message from VibeBuild");
    log("");
  }

  log("=== Done ===");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
