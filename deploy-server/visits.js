// Visit counts for published apps: one number per app per UTC day (table vibebuild_app_visits), nothing about the visitor.
//
// A visit is a published page that actually ran in a visible browser tab: a few lines of script in the page call
// POST /__vb/visit on the app's own address. Not counted:
//   - bots: link previewers, crawlers and automated browsers (user agent, navigator.webdriver), and anything that never runs script;
//   - the creator's own browser: opening the app from VibeBuild adds a signed ?vb_own= link, which sets a cookie here
//     (backend/lib/ownerVisit.js makes it, same format);
//   - pages shown inside a frame (thumbnails and previews) and views inside the VibeBuild app;
//   - the same browser again within 30 minutes, and more than 30 a day from one address to one app.
// The two limits use a keyed digest of address and user agent held in memory only, with a key that is random per process and
// replaced daily. No address or user agent is stored or logged.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const BEACON_PATH = "/__vb/visit";
export const OWNER_PARAM = "vb_own";
export const OWNER_COOKIE = "__Host-vb_own"; // __Host- cookies cannot be set for the whole domain by another published app
const APP_PACKAGE = "com.kreativekoala.vibecoder";
const REPEAT_MS = 30 * 60_000;
const PER_ADDRESS_PER_DAY = 30;
const DAY_MS = 24 * 60 * 60_000;

// "cubot" is a phone brand, not a bot.
const BOT_UA = /(?<!cu)bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|phantomjs|puppeteer|playwright|selenium|webdriver|facebookexternalhit|whatsapp\/|telegrambot|bingpreview|python|curl\/|wget|httpclient|okhttp|axios|node-fetch|go-http|java\/|libwww|scrapy|monitor|uptime|pingdom|screenshot|scanner|validator|google-inspectiontool|gptbot|claude|anthropic|bytespider/i;

export function isBotUserAgent(ua) {
  return typeof ua !== "string" || !/^mozilla\//i.test(ua) || BOT_UA.test(ua);
}

export function ownerMac(secret, subdomain, expiresAt) {
  return createHmac("sha256", secret).update(`vb-own:v1:${subdomain}:${expiresAt}`).digest("base64url").slice(0, 32);
}

export function isOwnerToken(secret, subdomain, token, nowMs = Date.now()) {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{32})$/.exec(typeof token === "string" ? token : "");
  if (!secret || !m || Number(m[1]) * 1000 < nowMs) return false;
  const given = Buffer.from(m[2]);
  const want = Buffer.from(ownerMac(secret, subdomain, m[1]));
  return given.length === want.length && timingSafeEqual(given, want);
}

export const BEACON_SCRIPT = `<script>(function(){try{if(window.top!==window.self||navigator.webdriver)return;var done=false;function go(){if(done||document.visibilityState!=="visible")return;done=true;if(navigator.sendBeacon)navigator.sendBeacon("${BEACON_PATH}");else fetch("${BEACON_PATH}",{method:"POST",keepalive:true}).catch(function(){})}document.addEventListener("visibilitychange",go);go()}catch(e){}})();</script>`;

export function injectBeacon(html) {
  const at = html.lastIndexOf("</body>");
  return at === -1 ? html + BEACON_SCRIPT : html.slice(0, at) + BEACON_SCRIPT + html.slice(at);
}

const hasOwnerCookie = (req) => String(req.headers.cookie || "").split(";").some((c) => c.trim() === `${OWNER_COOKIE}=1`);

// Behind the custom-domain proxy the connection comes from the proxy, which says who the visitor is.
function addressOf(req) {
  const h = req.headers;
  const forwarded = h["x-forwarded-host"] ? h["cf-connecting-ip"] || String(h["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return String(forwarded || h["fly-client-ip"] || req.socket?.remoteAddress || "unknown");
}

/**
 * @param {{ record: (subdomain: string) => Promise<{ error?: any }>, secret: string, onResult?: (error: any) => void, now?: () => number, maxKeys?: number }} deps
 */
export function createVisitCounter({ record, secret, onResult = () => {}, now = () => Date.now(), maxKeys = 50_000 }) {
  let key = randomBytes(32);
  let keyDay = Math.floor(now() / DAY_MS);
  const recent = new Map(); // digest(address, user agent, app) -> time last counted
  const perAddress = new Map(); // digest(address, app) -> visits counted today

  const digest = (...parts) => createHmac("sha256", key).update(parts.join("\n")).digest("base64");
  const keep = (map, k, v) => { map.delete(k); map.set(k, v); while (map.size > maxKeys) map.delete(map.keys().next().value); };

  /** Returns true when the request was an owner link: the response (a redirect to the clean address) has been sent. */
  function handleOwnerLink(req, res, subdomain) {
    const [path, ...rest] = String(req.originalUrl || req.url || "/").split("?");
    const query = new URLSearchParams(rest.join("?"));
    if (!query.has(OWNER_PARAM)) return false;
    if (isOwnerToken(secret, subdomain, query.get(OWNER_PARAM), now())) {
      res.setHeader("Set-Cookie", `${OWNER_COOKIE}=1; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`);
    }
    query.delete(OWNER_PARAM);
    // Always a path on this host: leading slashes and backslashes would otherwise name another site.
    const clean = "/" + path.replace(/^[/\\]+/, "");
    const search = query.toString();
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, search ? `${clean}?${search}` : clean);
    return true;
  }

  /** Whether this beacon request is a visit to count. Marks it as counted. */
  function shouldCount(req, subdomain, host) {
    const h = req.headers;
    // The page's own script, from the page's own address.
    let origin;
    try { origin = new URL(h.origin).hostname.toLowerCase(); } catch { return false; }
    if (origin !== host) return false;
    if (h["sec-fetch-site"] && h["sec-fetch-site"] !== "same-origin") return false;
    const ua = h["user-agent"];
    if (isBotUserAgent(ua) || /VibeBuildApp/.test(ua) || h["x-requested-with"] === APP_PACKAGE) return false;
    if (hasOwnerCookie(req)) return false;

    const t = now();
    const day = Math.floor(t / DAY_MS);
    if (day !== keyDay) { keyDay = day; key = randomBytes(32); recent.clear(); perAddress.clear(); }
    const address = addressOf(req);
    const visitor = digest(address, ua, subdomain);
    if (t - (recent.get(visitor) ?? -Infinity) < REPEAT_MS) return false;
    const from = digest(address, subdomain);
    const count = perAddress.get(from) || 0;
    if (count >= PER_ADDRESS_PER_DAY) return false;
    keep(recent, visitor, t);
    keep(perAddress, from, count + 1);
    return true;
  }

  /** Always answers 204: a visitor's page never sees whether it was counted, or a failure. */
  function handleBeacon(req, res, subdomain, host) {
    res.setHeader("Cache-Control", "no-store");
    res.status(204).end();
    try {
      if (!subdomain || !shouldCount(req, subdomain, host)) return Promise.resolve();
      return Promise.resolve(record(subdomain)).then((r) => onResult(r?.error || null), (e) => onResult(e));
    } catch (e) {
      onResult(e);
      return Promise.resolve();
    }
  }

  return { handleOwnerLink, handleBeacon, shouldCount };
}
