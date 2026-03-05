import express from "express";
import fs from "fs";
import path from "path";
import { Buffer } from "buffer";
import zlib from "zlib";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "4000", 10);
const DEPLOY_DIR = path.resolve(process.env.DEPLOY_DIR || "./deployments");
const BASE_DOMAIN = process.env.BASE_DOMAIN || "vibebuild.cc";
const MAX_BUNDLE_SIZE = parseInt(
  process.env.MAX_BUNDLE_SIZE || String(50 * 1024 * 1024),
  10,
); // 50 MB default
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "vibecoder-internal-secret";

// Ensure the deployments directory exists on startup.
fs.mkdirSync(DEPLOY_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Custom domain → subdomain mapping (synced from backend every 60s)
// ---------------------------------------------------------------------------

/** @type {Map<string, string>} domain → subdomain */
const domainMap = new Map();

async function syncDomainMap() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/deploy/internal/domain-map`, {
      headers: { "x-internal-secret": INTERNAL_SECRET },
    });
    if (!response.ok) {
      console.warn(`Domain map sync failed: ${response.status}`);
      return;
    }
    const data = await response.json();
    const newMap = new Map();
    for (const { domain, subdomain } of data.mappings || []) {
      newMap.set(domain.toLowerCase(), subdomain.toLowerCase());
    }
    domainMap.clear();
    for (const [k, v] of newMap) domainMap.set(k, v);
    if (domainMap.size > 0) {
      console.log(`Domain map synced: ${domainMap.size} custom domain(s)`);
    }
  } catch (err) {
    console.warn("Domain map sync error:", err.message);
  }
}

// Initial sync + periodic refresh
syncDomainMap();
setInterval(syncDomainMap, 60_000);

// ---------------------------------------------------------------------------
// MIME type map (covers common web project files)
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
// ZIP extraction (pure Node zlib -- no native deps)
// ---------------------------------------------------------------------------

/**
 * Extracts a ZIP buffer into `destDir`.
 *
 * This is a minimal ZIP parser that handles the most common cases:
 *   - Stored (method 0) and Deflated (method 8) entries
 *   - Supports data descriptors (bit 3 flag)
 *   - Skips directory entries and __MACOSX / .DS_Store metadata
 *
 * The implementation reads the Central Directory to discover entries and then
 * seeks to the Local File Header for each one to extract the payload.
 */
async function unzipBundle(zipBuffer, destDir) {
  const buf = Buffer.isBuffer(zipBuffer)
    ? zipBuffer
    : Buffer.from(zipBuffer);

  // --- Locate End of Central Directory record (EOCD) ---
  // The EOCD signature is 0x06054b50.  It lives at the end of the file.
  // A ZIP comment can follow it (up to 65535 bytes), so we scan backwards.
  let eocdOffset = -1;
  const EOCD_SIG = 0x06054b50;
  const minEocdSize = 22; // minimum EOCD record size
  const searchStart = Math.max(0, buf.length - 65535 - minEocdSize);

  for (let i = buf.length - minEocdSize; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP: cannot find End of Central Directory record");
  }

  const cdEntries = buf.readUInt16LE(eocdOffset + 10); // total entries in CD
  const cdSize = buf.readUInt32LE(eocdOffset + 12); // size of CD
  const cdOffset = buf.readUInt32LE(eocdOffset + 16); // offset of start of CD

  // --- Walk Central Directory entries ---
  const CD_SIG = 0x02014b50;
  let pos = cdOffset;

  const entries = [];

  for (let i = 0; i < cdEntries; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CD_SIG) {
      throw new Error(`Invalid ZIP: bad Central Directory entry at offset ${pos}`);
    }

    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const fileNameLen = buf.readUInt16LE(pos + 28);
    const extraFieldLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);

    const fileName = buf.toString("utf8", pos + 46, pos + 46 + fileNameLen);

    entries.push({
      fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    // Advance past this CD entry
    pos += 46 + fileNameLen + extraFieldLen + commentLen;
  }

  // --- Extract each entry via its Local File Header ---
  const LOCAL_SIG = 0x04034b50;

  for (const entry of entries) {
    const { fileName, compressionMethod, localHeaderOffset } = entry;

    // Skip directories, macOS metadata, and hidden files
    if (
      fileName.endsWith("/") ||
      fileName.startsWith("__MACOSX") ||
      fileName.includes("/__MACOSX/") ||
      fileName === ".DS_Store" ||
      fileName.endsWith("/.DS_Store")
    ) {
      continue;
    }

    // Security: prevent path traversal
    const normalized = path.normalize(fileName);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      console.warn(`Skipping suspicious path in ZIP: ${fileName}`);
      continue;
    }

    // Read Local File Header
    const lhOff = localHeaderOffset;
    if (lhOff + 30 > buf.length || buf.readUInt32LE(lhOff) !== LOCAL_SIG) {
      throw new Error(`Invalid ZIP: bad Local File Header at offset ${lhOff}`);
    }

    const lhGeneralFlag = buf.readUInt16LE(lhOff + 6);
    const lhCompMethod = buf.readUInt16LE(lhOff + 8);
    const lhCompSize = buf.readUInt32LE(lhOff + 18);
    const lhUncompSize = buf.readUInt32LE(lhOff + 22);
    const lhFileNameLen = buf.readUInt16LE(lhOff + 26);
    const lhExtraLen = buf.readUInt16LE(lhOff + 28);

    const dataOffset = lhOff + 30 + lhFileNameLen + lhExtraLen;

    // Determine sizes -- if bit 3 of the general purpose flag is set, the
    // sizes in the local header are zero and appear in a data descriptor
    // after the file data.  In that case we fall back to the CD sizes.
    const compSize =
      lhGeneralFlag & 0x08 ? entry.compressedSize : lhCompSize;
    const uncompSize =
      lhGeneralFlag & 0x08 ? entry.uncompressedSize : lhUncompSize;

    if (dataOffset + compSize > buf.length) {
      throw new Error(
        `Invalid ZIP: file data for "${fileName}" exceeds buffer (offset=${dataOffset}, size=${compSize}, bufLen=${buf.length})`,
      );
    }

    const rawData = buf.subarray(dataOffset, dataOffset + compSize);

    let fileData;
    if (compressionMethod === 0) {
      // Stored (no compression)
      fileData = rawData;
    } else if (compressionMethod === 8) {
      // Deflated -- use raw inflate (wbits = -15)
      fileData = await new Promise((resolve, reject) => {
        zlib.inflateRaw(rawData, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    } else {
      console.warn(
        `Skipping "${fileName}": unsupported compression method ${compressionMethod}`,
      );
      continue;
    }

    // Write to disk
    const destPath = path.join(destDir, normalized);
    const destDirForFile = path.dirname(destPath);
    fs.mkdirSync(destDirForFile, { recursive: true });
    fs.writeFileSync(destPath, fileData);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the subdomain from the Host header, or null if the request is
 * to the bare base domain (or localhost without a subdomain).
 *
 * Examples (BASE_DOMAIN = "vibecoder.app"):
 *   "my-project.vibecoder.app"  -> "my-project"
 *   "vibecoder.app"             -> null
 *
 * Examples (BASE_DOMAIN = "localhost"):
 *   "my-project.localhost"      -> "my-project"
 *   "my-project.localhost:4000" -> "my-project"
 *   "localhost:4000"            -> null
 */
function subdomainFromHost(host) {
  if (!host) return null;
  // Strip port
  const hostname = host.split(":")[0];
  if (hostname === BASE_DOMAIN) return null;
  if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
    const sub = hostname.slice(0, -(BASE_DOMAIN.length + 1));
    // Only allow simple, single-level subdomains
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(sub)) {
      return sub.toLowerCase();
    }
  }
  return null;
}

/**
 * Validates that a subdomain string is safe to use as a directory name.
 */
function isValidSubdomain(s) {
  return typeof s === "string" && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s) && s.length <= 63;
}

/**
 * Returns a friendly 404 HTML page.
 */
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
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
      color: #e0e0e0;
    }
    .card {
      text-align: center;
      padding: 3rem 2.5rem;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 1rem;
      backdrop-filter: blur(12px);
      max-width: 440px;
    }
    h1 { font-size: 4rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.25rem; font-weight: 500; margin-bottom: 1rem; color: #a5b4fc; }
    p { color: #9ca3af; line-height: 1.6; }
    code {
      background: rgba(255,255,255,0.08);
      padding: 0.15em 0.4em;
      border-radius: 4px;
      font-size: 0.95em;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>404</h1>
    <h2>Project Not Found</h2>
    <p>
      ${subdomain ? `No deployment exists for <code>${subdomain}</code>.` : "The requested project could not be found."}
      <br/>It may not have been published yet.
    </p>
  </div>
</body>
</html>`;
}

/**
 * Serves a static file from a project directory with proper MIME types and
 * cache headers.  Falls back to index.html for SPA-style routing.
 */
function serveProjectFile(projectDir, reqPath, res) {
  // Normalize and resolve the requested path within the project directory.
  // Default to index.html when the path is "/" or empty.
  let filePath = path.join(projectDir, reqPath === "/" || reqPath === "" ? "index.html" : reqPath);

  // Security: ensure we don't escape the project directory
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(projectDir))) {
    res.status(403).send("Forbidden");
    return;
  }

  // If the path is a directory, look for index.html inside it
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    filePath = path.join(resolved, "index.html");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // SPA fallback: try serving the root index.html so client-side routing works
    const spaFallback = path.join(projectDir, "index.html");
    if (fs.existsSync(spaFallback) && fs.statSync(spaFallback).isFile()) {
      filePath = spaFallback;
    } else {
      res.status(404).send("File not found");
      return;
    }
  }

  // Determine MIME type
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  // Cache headers -- immutable hashed assets get long cache, HTML gets none
  let cacheControl = "public, max-age=3600"; // default: 1 hour
  if (ext === ".html" || ext === ".htm") {
    cacheControl = "no-cache";
  } else if (/\.[a-f0-9]{8,}\.(js|css|png|jpg|jpeg|gif|svg|woff2?)$/i.test(path.basename(filePath))) {
    // Looks like a content-hashed asset (e.g. main.a1b2c3d4.js)
    cacheControl = "public, max-age=31536000, immutable";
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("X-Content-Type-Options", "nosniff");

  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    res.status(500).send("Internal server error");
  });
  stream.pipe(res);
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// Parse JSON bodies up to the max bundle size (base64 inflates ~33%)
app.use(
  express.json({
    limit: `${Math.ceil(MAX_BUNDLE_SIZE * 1.4)}b`,
  }),
);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  const deployments = fs.readdirSync(DEPLOY_DIR).filter((name) => {
    const full = path.join(DEPLOY_DIR, name);
    return fs.statSync(full).isDirectory();
  });

  res.json({
    status: "ok",
    uptime: process.uptime(),
    deployments: deployments.length,
    deploymentList: deployments,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// POST /deploy -- receive and extract a project bundle
// ---------------------------------------------------------------------------

app.post("/deploy", async (req, res) => {
  try {
    const { subdomain, bundle } = req.body || {};

    if (!subdomain || !bundle) {
      return res.status(400).json({
        error: "Missing required fields: subdomain, bundle",
      });
    }

    const normalizedSubdomain = subdomain.toLowerCase().trim();

    if (!isValidSubdomain(normalizedSubdomain)) {
      return res.status(400).json({
        error:
          "Invalid subdomain. Must be 1-63 characters, lowercase alphanumeric and hyphens, cannot start or end with a hyphen.",
      });
    }

    // Decode the base64 ZIP bundle
    let zipBuffer;
    try {
      zipBuffer = Buffer.from(bundle, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid base64 bundle" });
    }

    if (zipBuffer.length > MAX_BUNDLE_SIZE) {
      return res.status(413).json({
        error: `Bundle too large. Maximum size is ${(MAX_BUNDLE_SIZE / 1024 / 1024).toFixed(0)} MB.`,
      });
    }

    if (zipBuffer.length < 4) {
      return res.status(400).json({ error: "Bundle too small to be a valid ZIP" });
    }

    const destDir = path.join(DEPLOY_DIR, normalizedSubdomain);

    // Remove existing deployment if present (atomic-ish swap)
    const tmpDir = `${destDir}.__deploying__`;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      await unzipBundle(zipBuffer, tmpDir);
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.error(`Failed to extract bundle for "${normalizedSubdomain}":`, err);
      return res.status(400).json({
        error: "Failed to extract ZIP bundle",
        details: err.message,
      });
    }

    // Swap: remove old, rename tmp to final
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    fs.renameSync(tmpDir, destDir);

    // List deployed files for confirmation
    const deployedFiles = [];
    function walkDir(dir, prefix = "") {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walkDir(path.join(dir, entry.name), rel);
        } else {
          deployedFiles.push(rel);
        }
      }
    }
    walkDir(destDir);

    console.log(
      `Deployed "${normalizedSubdomain}" -- ${deployedFiles.length} file(s)`,
    );

    return res.json({
      ok: true,
      subdomain: normalizedSubdomain,
      files: deployedFiles,
      url: `http://${normalizedSubdomain}.${BASE_DOMAIN}${PORT !== 80 ? `:${PORT}` : ""}`,
      pathUrl: `http://${BASE_DOMAIN}${PORT !== 80 ? `:${PORT}` : ""}/p/${normalizedSubdomain}/`,
    });
  } catch (err) {
    console.error("Deploy error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /deploy/:subdomain -- remove a deployment
// ---------------------------------------------------------------------------

app.delete("/deploy/:subdomain", (req, res) => {
  const subdomain = req.params.subdomain.toLowerCase().trim();

  if (!isValidSubdomain(subdomain)) {
    return res.status(400).json({ error: "Invalid subdomain" });
  }

  const destDir = path.join(DEPLOY_DIR, subdomain);

  if (!fs.existsSync(destDir)) {
    return res.status(404).json({ error: "Deployment not found" });
  }

  fs.rmSync(destDir, { recursive: true, force: true });
  console.log(`Removed deployment "${subdomain}"`);

  return res.json({ ok: true, subdomain, message: "Deployment removed" });
});

// ---------------------------------------------------------------------------
// GET /deployments -- list all current deployments
// ---------------------------------------------------------------------------

app.get("/deployments", (_req, res) => {
  const deployments = fs
    .readdirSync(DEPLOY_DIR)
    .filter((name) => {
      const full = path.join(DEPLOY_DIR, name);
      return fs.statSync(full).isDirectory() && !name.startsWith(".");
    })
    .map((name) => ({
      subdomain: name,
      url: `http://${name}.${BASE_DOMAIN}${PORT !== 80 ? `:${PORT}` : ""}`,
      pathUrl: `http://${BASE_DOMAIN}${PORT !== 80 ? `:${PORT}` : ""}/p/${name}/`,
    }));

  res.json({ deployments });
});

// ---------------------------------------------------------------------------
// Path-based project serving:  /p/:subdomain/*
// ---------------------------------------------------------------------------

app.get("/p/:subdomain/*", (req, res) => {
  const subdomain = req.params.subdomain.toLowerCase();
  const projectDir = path.join(DEPLOY_DIR, subdomain);

  if (!isValidSubdomain(subdomain) || !fs.existsSync(projectDir)) {
    return res.status(404).type("html").send(notFoundPage(subdomain));
  }

  // Everything after /p/:subdomain
  const filePath = "/" + (req.params[0] || "");
  serveProjectFile(projectDir, filePath, res);
});

// Redirect /p/:subdomain to /p/:subdomain/ for consistency
app.get("/p/:subdomain", (req, res) => {
  res.redirect(301, `/p/${req.params.subdomain}/`);
});

// ---------------------------------------------------------------------------
// Subdomain-based project serving (catch-all)
// ---------------------------------------------------------------------------

app.get("*", (req, res) => {
  const host = (req.headers.host || "").split(":")[0].toLowerCase();

  // 1. Check custom domain map first
  const customSubdomain = domainMap.get(host);
  if (customSubdomain) {
    const projectDir = path.join(DEPLOY_DIR, customSubdomain);
    if (fs.existsSync(projectDir)) {
      return serveProjectFile(projectDir, req.path, res);
    }
  }

  // 2. Fall back to subdomain resolution
  const subdomain = subdomainFromHost(req.headers.host);

  if (!subdomain) {
    // Request is to the bare domain -- show a simple landing / 404
    return res.status(404).type("html").send(notFoundPage(null));
  }

  const projectDir = path.join(DEPLOY_DIR, subdomain);

  if (!fs.existsSync(projectDir)) {
    return res.status(404).type("html").send(notFoundPage(subdomain));
  }

  serveProjectFile(projectDir, req.path, res);
});

// ---------------------------------------------------------------------------
// Preview deployment cleanup (preview-* dirs older than 2 hours)
// ---------------------------------------------------------------------------

function cleanupPreviews() {
  try {
    const entries = fs.readdirSync(DEPLOY_DIR);
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours
    let cleaned = 0;

    for (const name of entries) {
      if (!name.startsWith("preview-")) continue;
      const dir = path.join(DEPLOY_DIR, name);
      try {
        const stat = fs.statSync(dir);
        if (stat.isDirectory() && now - stat.mtimeMs > maxAge) {
          fs.rmSync(dir, { recursive: true, force: true });
          cleaned++;
        }
      } catch {}
    }

    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired preview deployment(s)`);
    }
  } catch (err) {
    console.warn("Preview cleanup error:", err.message);
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupPreviews, 30 * 60 * 1000);
// Initial cleanup on startup
cleanupPreviews();

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`VibeCoder deploy server running on port ${PORT}`);
  console.log(`  Deploy dir : ${DEPLOY_DIR}`);
  console.log(`  Base domain: ${BASE_DOMAIN}`);
  console.log(`  Health     : http://localhost:${PORT}/health`);
  console.log(`  Path routes: http://localhost:${PORT}/p/<subdomain>/`);
});
