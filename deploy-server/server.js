import express from "express";
import { Buffer } from "buffer";
import zlib from "zlib";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "4000", 10);
const BASE_DOMAIN = process.env.BASE_DOMAIN || "vibebuild.cc";
const MAX_BUNDLE_SIZE = parseInt(
  process.env.MAX_BUNDLE_SIZE || String(50 * 1024 * 1024),
  10,
);
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "deployments";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "vibecoder-internal-secret";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // service role key required for storage writes
);

// ---------------------------------------------------------------------------
// Custom domain → subdomain mapping (synced from backend every 60s)
// ---------------------------------------------------------------------------

const domainMap = new Map();

async function syncDomainMap() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/deploy/internal/domain-map`, {
      headers: { "x-internal-secret": INTERNAL_SECRET },
    });
    if (!response.ok) return;
    const data = await response.json();
    domainMap.clear();
    for (const { domain, subdomain } of data.mappings || []) {
      domainMap.set(domain.toLowerCase(), subdomain.toLowerCase());
    }
    if (domainMap.size > 0) console.log(`Domain map synced: ${domainMap.size} custom domain(s)`);
  } catch (err) {
    console.warn("Domain map sync error:", err.message);
  }
}

syncDomainMap();
setInterval(syncDomainMap, 60_000);

// ---------------------------------------------------------------------------
// MIME type map
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

// ---------------------------------------------------------------------------
// ZIP extraction (pure Node zlib)
// ---------------------------------------------------------------------------

async function unzipBundle(zipBuffer) {
  const buf = Buffer.isBuffer(zipBuffer) ? zipBuffer : Buffer.from(zipBuffer);

  let eocdOffset = -1;
  const EOCD_SIG = 0x06054b50;
  const minEocdSize = 22;
  const searchStart = Math.max(0, buf.length - 65535 - minEocdSize);
  for (let i = buf.length - minEocdSize; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error("Invalid ZIP: cannot find EOCD");

  const cdEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const CD_SIG = 0x02014b50;
  let pos = cdOffset;
  const entries = [];

  for (let i = 0; i < cdEntries; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CD_SIG)
      throw new Error(`Invalid ZIP: bad CD entry at ${pos}`);
    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const fileNameLen = buf.readUInt16LE(pos + 28);
    const extraFieldLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const fileName = buf.toString("utf8", pos + 46, pos + 46 + fileNameLen);
    entries.push({ fileName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    pos += 46 + fileNameLen + extraFieldLen + commentLen;
  }

  const LOCAL_SIG = 0x04034b50;
  const files = [];

  for (const entry of entries) {
    const { fileName, compressionMethod, localHeaderOffset } = entry;
    if (
      fileName.endsWith("/") ||
      fileName.startsWith("__MACOSX") ||
      fileName.includes("/__MACOSX/") ||
      fileName === ".DS_Store" ||
      fileName.endsWith("/.DS_Store")
    ) continue;

    const normalized = path.normalize(fileName);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      console.warn(`Skipping suspicious path: ${fileName}`);
      continue;
    }

    const lhOff = localHeaderOffset;
    if (lhOff + 30 > buf.length || buf.readUInt32LE(lhOff) !== LOCAL_SIG)
      throw new Error(`Invalid ZIP: bad LFH at ${lhOff}`);

    const lhGeneralFlag = buf.readUInt16LE(lhOff + 6);
    const lhCompSize = buf.readUInt32LE(lhOff + 18);
    const lhFileNameLen = buf.readUInt16LE(lhOff + 26);
    const lhExtraLen = buf.readUInt16LE(lhOff + 28);
    const dataOffset = lhOff + 30 + lhFileNameLen + lhExtraLen;
    const compSize = lhGeneralFlag & 0x08 ? entry.compressedSize : lhCompSize;
    const rawData = buf.subarray(dataOffset, dataOffset + compSize);

    let fileData;
    if (compressionMethod === 0) {
      fileData = rawData;
    } else if (compressionMethod === 8) {
      fileData = await new Promise((resolve, reject) => {
        zlib.inflateRaw(rawData, (err, result) => err ? reject(err) : resolve(result));
      });
    } else {
      console.warn(`Skipping "${fileName}": unsupported compression ${compressionMethod}`);
      continue;
    }

    files.push({ name: normalized, data: fileData });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Supabase Storage helpers
// ---------------------------------------------------------------------------

async function uploadFilesToStorage(subdomain, files) {
  // Strip common root directory if all files share one (e.g. repo-name/index.html → index.html)
  let stripPrefix = "";
  if (files.length > 0) {
    const firstSep = files[0].name.indexOf("/");
    if (firstSep > 0) {
      const candidate = files[0].name.slice(0, firstSep + 1);
      if (files.every(f => f.name.startsWith(candidate))) {
        stripPrefix = candidate;
      }
    }
  }

  await Promise.all(files.map(async ({ name, data }) => {
    const relativeName = stripPrefix ? name.slice(stripPrefix.length) : name;
    if (!relativeName) return; // skip root dir entry itself
    const storagePath = `${subdomain}/${relativeName}`;
    const ext = path.extname(relativeName).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, data, { contentType, upsert: true });
    if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
  }));
}

async function listAllStoragePaths(prefix) {
  const paths = [];
  const { data: items, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(prefix, { limit: 1000 });
  if (error || !items?.length) return paths;
  for (const item of items) {
    const fullPath = `${prefix}/${item.name}`;
    if (item.metadata == null) {
      // it's a folder — recurse
      const nested = await listAllStoragePaths(fullPath);
      paths.push(...nested);
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

async function deleteSubdomainFromStorage(subdomain) {
  const paths = await listAllStoragePaths(subdomain);
  if (!paths.length) return;
  // Delete in batches of 100 (Supabase limit)
  for (let i = 0; i < paths.length; i += 100) {
    await supabase.storage.from(STORAGE_BUCKET).remove(paths.slice(i, i + 100));
  }
}

async function findNestedIndexHtml(subdomain) {
  // For deployments that still have a root folder, find the index.html one level deep
  const { data: topItems } = await supabase.storage.from(STORAGE_BUCKET).list(subdomain, { limit: 100 });
  if (!topItems) return null;
  for (const item of topItems) {
    if (item.metadata == null) {
      // folder — check inside
      return `${subdomain}/${item.name}/index.html`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ads injection
// ---------------------------------------------------------------------------

const adsCache = new Map(); // subdomain → { enabled: bool, checkedAt: number }
const ADS_CACHE_TTL = 60_000; // 1 minute

// Returns 'adsense' if monetization enabled + AdSense configured, 'promo' for VibeBuild banner, false for none
async function getAdMode(subdomain) {
  const cached = adsCache.get(subdomain);
  if (cached && Date.now() - cached.checkedAt < ADS_CACHE_TTL) return cached.mode;

  try {
    const { data } = await supabase
      .from('deployments')
      .select('ads_enabled')
      .eq('subdomain', subdomain)
      .single();
    const monetized = data?.ads_enabled || false;
    const mode = monetized && ADSENSE_CLIENT_ID ? 'adsense' : 'promo';
    adsCache.set(subdomain, { mode, checkedAt: Date.now() });
    return mode;
  } catch {
    return 'promo'; // Default: always show VibeBuild promo
  }
}

// AdSense client ID — set this once your AdSense account is approved for vibebuild.cc
const ADSENSE_CLIENT_ID = process.env.ADSENSE_CLIENT_ID || '';
const ADSENSE_AD_SLOT = process.env.ADSENSE_AD_SLOT || '';


// Apple UGC guideline (1.2) requires a takedown affordance visible on every
// public page that hosts user-generated content. The "Report" link uses a
// mailto with the page's URL pre-filled so abuse@ can act within 24 hours.
const PROMO_SCRIPT = `
<!-- VibeBuild Promo -->
<div id="vb-ad" style="position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#111;border-top:1px solid #333;padding:8px 12px;display:flex;align-items:center;gap:8px;font-family:system-ui;font-size:13px;color:#ccc">
  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Built with <a href="https://vibebuild.cc" target="_blank" style="color:#7c3aed;text-decoration:none;font-weight:600">VibeBuild</a></span>
  <a href="#" onclick="event.preventDefault();var u=encodeURIComponent(location.href);location.href='mailto:abuse@kreativekoala.com?subject=Report%20VibeBuild%20page&body=URL%3A%20'+u+'%0A%0AReason%3A%20';" style="color:#888;text-decoration:underline;font-size:11px;white-space:nowrap">Report</a>
  <a href="https://vibebuild.cc" target="_blank" style="background:#7c3aed;color:#fff;padding:4px 12px;border-radius:12px;text-decoration:none;font-size:12px;font-weight:600;white-space:nowrap">Try Free</a>
</div>
<style>#vb-ad a:hover{opacity:0.9}body{padding-bottom:44px!important}</style>
`;
const ADSENSE_SCRIPT = ADSENSE_CLIENT_ID && ADSENSE_AD_SLOT ? `
<!-- VibeBuild AdSense -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}" crossorigin="anonymous"></script>
<div id="vb-ad" style="position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#111;border-top:1px solid #333">
  <ins class="adsbygoogle" style="display:block" data-ad-client="${ADSENSE_CLIENT_ID}" data-ad-slot="${ADSENSE_AD_SLOT}" data-ad-format="horizontal" data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
</div>
<style>body{padding-bottom:60px!important}</style>
` : null;

function injectAds(html, mode) {
  const script = (mode === 'adsense' && ADSENSE_SCRIPT) ? ADSENSE_SCRIPT : PROMO_SCRIPT;
  if (html.includes('</body>')) {
    return html.replace('</body>', script + '</body>');
  }
  return html + script;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Play tracking — fire-and-forget when HTML is served
// ---------------------------------------------------------------------------
const playTrackDedup = new Map(); // key: `${ip}:${subdomain}` → timestamp

function trackPlay(subdomain, ip) {
    const key = `${ip}:${subdomain}`;
    const last = playTrackDedup.get(key);
    if (last && Date.now() - last < 3600000) return; // 1hr dedup
    playTrackDedup.set(key, Date.now());

    fetch(`${BACKEND_URL}/api/projects/track-play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, ip }),
    }).catch(() => {}); // fire-and-forget
}

// Clean up play dedup cache every 30 minutes
setInterval(() => {
    const cutoff = Date.now() - 3600000;
    for (const [key, ts] of playTrackDedup) {
        if (ts < cutoff) playTrackDedup.delete(key);
    }
}, 1800000);

async function serveFromStorage(subdomain, reqPath, res) {
  const normalized = reqPath === "/" || reqPath === ""
    ? "index.html"
    : path.normalize(reqPath).replace(/^\/+/, "");

  const tryPaths = [`${subdomain}/${normalized}`];
  if (!path.extname(normalized)) tryPaths.push(`${subdomain}/index.html`);
  if (!tryPaths.includes(`${subdomain}/index.html`)) tryPaths.push(`${subdomain}/index.html`);

  for (const storagePath of tryPaths) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (error || !data) continue;

    const ext = path.extname(storagePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    let cacheControl = "public, max-age=3600";
    if (ext === ".html" || ext === ".htm") {
      cacheControl = "no-cache";
    } else if (/\.[a-f0-9]{8,}\.(js|css|png|jpg|jpeg|gif|svg|woff2?)$/i.test(path.basename(storagePath))) {
      cacheControl = "public, max-age=31536000, immutable";
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    res.setHeader("X-Content-Type-Options", "nosniff");

    const arrayBuffer = await data.arrayBuffer();
    let body = Buffer.from(arrayBuffer);

    // Inject promo banner into all HTML pages
    // When AdSense is approved, switch to: const adMode = await getAdMode(subdomain);
    if (ext === ".html" || ext === ".htm") {
      body = Buffer.from(injectAds(body.toString("utf-8"), "promo"));
    }

    res.send(body);
    return;
  }

  // Fallback: deployment may still use old nested structure — try one level deep
  const nestedIndex = await findNestedIndexHtml(subdomain);
  if (nestedIndex) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(nestedIndex);
    if (!error && data) {
      // Also try the actual requested file in the nested folder
      if (normalized !== "index.html") {
        const nestedFolder = nestedIndex.replace(/\/index\.html$/, "");
        const nestedPath = `${nestedFolder}/${normalized}`;
        const { data: nestedData, error: nestedErr } = await supabase.storage.from(STORAGE_BUCKET).download(nestedPath);
        if (!nestedErr && nestedData) {
          const ext = path.extname(nestedPath).toLowerCase();
          res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.send(Buffer.from(await nestedData.arrayBuffer()));
          return;
        }
      }
      // Serve nested index.html (SPA fallback)
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(Buffer.from(await data.arrayBuffer()));
      return;
    }
  }

  res.status(404).type("html").send(notFoundPage(subdomain));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function subdomainFromHost(host) {
  if (!host) return null;
  const hostname = host.split(":")[0];
  if (hostname === BASE_DOMAIN) return null;
  if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
    const sub = hostname.slice(0, -(BASE_DOMAIN.length + 1));
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(sub)) return sub.toLowerCase();
  }
  return null;
}

function isValidSubdomain(s) {
  return typeof s === "string" && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s) && s.length <= 63;
}

function notFoundPage(subdomain) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project Not Found</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #0f0c29, #302b63, #24243e); color: #e0e0e0;
    }
    .card { text-align: center; padding: 3rem 2.5rem; background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1); border-radius: 1rem; backdrop-filter: blur(12px); max-width: 440px; }
    h1 { font-size: 4rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.25rem; font-weight: 500; margin-bottom: 1rem; color: #a5b4fc; }
    p { color: #9ca3af; line-height: 1.6; }
    code { background: rgba(255,255,255,0.08); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.95em; }
  </style>
</head>
<body>
  <div class="card">
    <h1>404</h1>
    <h2>Project Not Found</h2>
    <p>${subdomain ? `No deployment exists for <code>${subdomain}</code>.` : "The requested project could not be found."}<br/>It may not have been published yet.</p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: `${Math.ceil(MAX_BUNDLE_SIZE * 1.4)}b` }));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

// ads.txt for AdSense verification (served on all subdomains + root)
app.get("/ads.txt", (_req, res) => {
  res.type("text/plain").send("google.com, pub-5764510017766009, DIRECT, f08c47fec0942fa0\n");
});

app.get("/health", async (_req, res) => {
  const { data } = await supabase.storage.from(STORAGE_BUCKET).list("", { limit: 1 });
  res.json({ status: "ok", uptime: process.uptime(), storage: data ? "connected" : "error", timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// POST /deploy
// ---------------------------------------------------------------------------

app.post("/deploy", async (req, res) => {
  try {
    const { subdomain, bundle } = req.body || {};
    if (!subdomain || !bundle) {
      return res.status(400).json({ error: "Missing required fields: subdomain, bundle" });
    }

    const normalizedSubdomain = subdomain.toLowerCase().trim();
    if (!isValidSubdomain(normalizedSubdomain)) {
      return res.status(400).json({ error: "Invalid subdomain. Must be 1-63 characters, lowercase alphanumeric and hyphens." });
    }

    let zipBuffer;
    try {
      zipBuffer = Buffer.from(bundle, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid base64 bundle" });
    }
    if (zipBuffer.length > MAX_BUNDLE_SIZE) {
      return res.status(413).json({ error: `Bundle too large. Max ${(MAX_BUNDLE_SIZE / 1024 / 1024).toFixed(0)} MB.` });
    }
    if (zipBuffer.length < 4) {
      return res.status(400).json({ error: "Bundle too small to be a valid ZIP" });
    }

    let files;
    try {
      files = await unzipBundle(zipBuffer);
    } catch (err) {
      return res.status(400).json({ error: "Failed to extract ZIP bundle", details: err.message });
    }

    await deleteSubdomainFromStorage(normalizedSubdomain);
    await uploadFilesToStorage(normalizedSubdomain, files);

    console.log(`Deployed "${normalizedSubdomain}" — ${files.length} file(s) to Supabase Storage`);

    return res.json({
      ok: true,
      subdomain: normalizedSubdomain,
      files: files.map((f) => f.name),
      url: `https://${normalizedSubdomain}.${BASE_DOMAIN}`,
    });
  } catch (err) {
    console.error("Deploy error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /deploy/:subdomain
// ---------------------------------------------------------------------------

app.delete("/deploy/:subdomain", async (req, res) => {
  const subdomain = req.params.subdomain.toLowerCase().trim();
  if (!isValidSubdomain(subdomain)) return res.status(400).json({ error: "Invalid subdomain" });
  await deleteSubdomainFromStorage(subdomain);
  console.log(`Removed deployment "${subdomain}"`);
  return res.json({ ok: true, subdomain, message: "Deployment removed" });
});

// ---------------------------------------------------------------------------
// POST /cleanup — Remove a preview deployment's files from storage
// ---------------------------------------------------------------------------

app.post("/cleanup", async (req, res) => {
  try {
    const { subdomain } = req.body || {};
    if (!subdomain) return res.status(400).json({ error: "subdomain required" });

    // List all files under the subdomain folder
    const { data: files } = await supabase.storage.from(STORAGE_BUCKET).list(subdomain, { limit: 1000 });
    if (files && files.length > 0) {
      const paths = files.map(f => `${subdomain}/${f.name}`);
      await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      console.log(`[cleanup] Removed ${paths.length} files for ${subdomain}`);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(`[cleanup] Error:`, error.message);
    res.status(500).json({ error: "Cleanup failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /deployments
// ---------------------------------------------------------------------------

app.get("/deployments", async (_req, res) => {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list("", { limit: 1000 });
  if (error) return res.status(500).json({ error: "Failed to list deployments" });
  res.json({
    deployments: (data || []).map((item) => ({
      subdomain: item.name,
      url: `https://${item.name}.${BASE_DOMAIN}`,
    })),
  });
});

// ---------------------------------------------------------------------------
// Path-based serving: /p/:subdomain/*
// ---------------------------------------------------------------------------

app.get("/p/:subdomain/*", async (req, res) => {
  const subdomain = req.params.subdomain.toLowerCase();
  if (!isValidSubdomain(subdomain)) return res.status(404).type("html").send(notFoundPage(subdomain));
  const filePath = "/" + (req.params[0] || "");
  // Track play on HTML page loads
  if (!filePath || filePath === "/" || filePath.endsWith(".html")) {
    const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
    trackPlay(subdomain, ip);
  }
  await serveFromStorage(subdomain, filePath, res);
});

app.get("/p/:subdomain", (req, res) => {
  res.redirect(301, `/p/${req.params.subdomain}/`);
});

// ---------------------------------------------------------------------------
// Subdomain / custom domain serving (catch-all)
// ---------------------------------------------------------------------------

app.get("*", async (req, res) => {
  // x-forwarded-host is set by Cloudflare Worker proxy; fall back to Host header
  const rawHost = req.headers["x-forwarded-host"] || req.headers.host || "";
  const host = rawHost.split(":")[0].toLowerCase();
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";

  const customSubdomain = domainMap.get(host);
  if (customSubdomain) {
    // Track play on HTML page loads
    if (!req.path || req.path === "/" || req.path.endsWith(".html")) {
      trackPlay(customSubdomain, ip);
    }
    return await serveFromStorage(customSubdomain, req.path, res);
  }

  const subdomain = subdomainFromHost(rawHost);
  if (!subdomain) return res.status(404).type("html").send(notFoundPage(null));

  // Track play on HTML page loads
  if (!req.path || req.path === "/" || req.path.endsWith(".html")) {
    trackPlay(subdomain, ip);
  }

  await serveFromStorage(subdomain, req.path, res);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`VibeBuild deploy server running on port ${PORT}`);
  console.log(`  Storage    : Supabase bucket "${STORAGE_BUCKET}"`);
  console.log(`  Base domain: ${BASE_DOMAIN}`);
  console.log(`  Health     : http://localhost:${PORT}/health`);
});
