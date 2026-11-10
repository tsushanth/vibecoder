import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

// App thumbnails are rendered by a screenshot service that only speaks plain HTTP and renders slowly (seconds per image) and
// fragilely (a handful of concurrent renders can wedge it for many minutes). This module is the one place that talks to it:
//   - the page it is asked to render is derived only from a validated https://<label>.<BASE_DOMAIN> app host (allow-list),
//   - the service origin is fixed configuration, never taken from a request,
//   - redirects are refused, the response must be a small real image, and the answer is cached (fresh, then served stale),
//   - at most `concurrency` renders run at once, a bounded queue waits, and a run of failures opens a breaker so a sick
//     service is left alone instead of being hammered.

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** The app label (the part before the base domain) of an https app URL, or null when the URL is not exactly https://<label>.<baseDomain>. */
export function appLabel(rawUrl, baseDomain) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2000) return null;
    let u;
    try { u = new URL(rawUrl); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const suffix = `.${baseDomain}`;
    if (!u.hostname.endsWith(suffix)) return null;
    const label = u.hostname.slice(0, -suffix.length);
    return LABEL.test(label) ? label : null;
}

/** True when `raw` is a screenshot-service style thumbnail (plain http, /screenshot path). Host is deliberately not checked. */
export function isScreenshotThumbnail(raw) {
    if (typeof raw !== 'string' || !raw) return false;
    try { const u = new URL(raw); return u.protocol === 'http:' && u.pathname === '/screenshot'; } catch { return false; }
}

/** Which app label to render for a project row: the page its stored screenshot URL points at, else its preview URL. */
export function thumbnailLabel(project, baseDomain) {
    const candidates = [];
    if (isScreenshotThumbnail(project?.thumbnail_url)) {
        try { candidates.push(new URL(project.thumbnail_url).searchParams.get('url')); } catch { /* ignored */ }
    }
    candidates.push(project?.preview_url);
    for (const c of candidates) {
        const label = appLabel(c, baseDomain);
        if (label) return label;
    }
    return null;
}

/**
 * Response-time rewrite for list APIs: a plain-http screenshot thumbnail becomes this API's https thumbnail route, so a client
 * on an https page (or with cleartext off) can load it. `miss=404` makes a failed render a 404, which clients already turn into
 * their own fallback (letter tile / live preview) instead of a gray placeholder. Stored rows are never changed.
 */
export function withHttpsThumbnail(project, origin) {
    if (!project || !project.id || !isScreenshotThumbnail(project.thumbnail_url)) return project;
    return { ...project, thumbnail_url: `${origin}/api/projects/${project.id}/thumbnail?miss=404` };
}

/** A solid neutral PNG (no dependencies), shown when a thumbnail cannot be produced. */
export function neutralPlaceholderPng(width = 78, height = 169, gray = 0xd9) {
    const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => {
        const out = Buffer.alloc(12 + data.length);
        out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
        return out;
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0; // 8-bit grayscale
    const raw = Buffer.alloc((width + 1) * height, gray);
    for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0; // filter byte: none
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function sniffType(b) {
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
    if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
}

async function readCapped(res, maxBytes) {
    const chunks = [];
    let total = 0;
    const reader = res.body?.getReader?.();
    if (!reader) throw new Error('no body');
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { reader.cancel().catch(() => {}); throw new Error('too large'); }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

export function createThumbnailService({
    fetchImpl = (...a) => fetch(...a),
    serviceUrl = process.env.SCREENSHOT_SERVICE_URL || 'http://178.156.231.255:3465',
    baseDomain = process.env.BASE_DOMAIN || 'vibebuild.cc',
    now = () => Date.now(),
    concurrency = 1,
    maxQueue = 50,
    upstreamTimeoutMs = 25_000,
    waitMs = 9_000,
    freshMs = 6 * 3600_000,
    staleMs = 7 * 24 * 3600_000,
    retryMs = 2 * 60_000,
    maxEntries = 300,
    maxTotalBytes = 32 * 1024 * 1024,
    maxImageBytes = 1024 * 1024,
    breakerFailures = 3,
    breakerOpenMs = 60_000,
    log = () => {},
} = {}) {
    if (!HOSTNAME.test(baseDomain)) throw new Error('invalid base domain');
    const origin = new URL(serviceUrl).origin;
    const cache = new Map(); // label -> {body, type, etag, at, retryAt}  (insertion order = least recently used first)
    const inflight = new Map(); // label -> Promise<entry>
    const failed = new Map(); // label -> retry-after time, for an app whose render failed (a dead or broken app is not re-rendered on every request)
    const queue = [];
    let active = 0;
    let failures = 0;
    let openUntil = 0;
    let totalBytes = 0;

    function store(label, entry) {
        const old = cache.get(label);
        if (old) { totalBytes -= old.body.length; cache.delete(label); }
        cache.set(label, entry); totalBytes += entry.body.length;
        while (cache.size > maxEntries || totalBytes > maxTotalBytes) {
            const [k, v] = cache.entries().next().value;
            totalBytes -= v.body.length; cache.delete(k);
        }
    }

    function pump() {
        while (active < concurrency && queue.length) {
            const job = queue.shift();
            active += 1;
            job().finally(() => { active -= 1; pump(); });
        }
    }

    async function render(label) {
        const target = `https://${label}.${baseDomain}`;
        const url = `${origin}/screenshot?url=${encodeURIComponent(target)}&width=390&height=844`;
        let res;
        try {
            res = await fetchImpl(url, { redirect: 'error', cache: 'no-store', headers: { accept: 'image/*' }, signal: AbortSignal.timeout(upstreamTimeoutMs) });
        } catch (e) { e.serviceDown = true; throw e; } // could not get an answer at all: the service, not the app, is the problem
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!IMAGE_TYPES.has(type)) throw new Error('not an image');
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxImageBytes) throw new Error('too large');
        const body = await readCapped(res, maxImageBytes);
        if (body.length === 0 || sniffType(body) !== type) throw new Error('bad image');
        return { body, type, etag: `"${createHash('sha1').update(body).digest('hex').slice(0, 20)}"`, at: now(), retryAt: 0 };
    }

    /** Joins or starts a render for `label`; null when the breaker is open or the queue is full. */
    function refresh(label) {
        const running = inflight.get(label);
        if (running) return running;
        if (now() < openUntil || queue.length >= maxQueue) return null;
        const p = new Promise((resolve, reject) => {
            queue.push(async () => {
                try {
                    const entry = await render(label);
                    failures = 0; failed.delete(label); store(label, entry); resolve(entry);
                } catch (e) {
                    if (e.serviceDown) failures += 1; else failures = 0;
                    failed.delete(label); failed.set(label, now() + retryMs);
                    while (failed.size > 1000) failed.delete(failed.keys().next().value);
                    if (failures >= breakerFailures) { openUntil = now() + breakerOpenMs; failures = 0; log(`[thumbnail] breaker open ${breakerOpenMs}ms: ${e.message}`); }
                    const stale = cache.get(label);
                    if (stale) stale.retryAt = now() + retryMs;
                    reject(e);
                } finally { inflight.delete(label); }
            });
        });
        p.catch(() => {}); // callers that stopped waiting must not leave an unhandled rejection
        inflight.set(label, p);
        pump();
        return p;
    }

    return {
        /** {state, entry}: hit | stale (served now, refreshed behind) | miss (rendered within waitMs) | busy (no image now). */
        async get(label) {
            if (!LABEL.test(label || '')) return { state: 'busy', entry: null };
            const e = cache.get(label);
            if (e && now() - e.at < freshMs) { cache.delete(label); cache.set(label, e); return { state: 'hit', entry: e }; }
            if (e && now() - e.at < staleMs) {
                cache.delete(label); cache.set(label, e);
                if (now() >= e.retryAt) refresh(label)?.catch(() => {});
                return { state: 'stale', entry: e };
            }
            if ((failed.get(label) || 0) > now()) return { state: 'busy', entry: null };
            const p = refresh(label);
            if (!p) return { state: 'busy', entry: null };
            let timer;
            const entry = await Promise.race([p.catch(() => null), new Promise((r) => { timer = setTimeout(() => r(null), waitMs); })]);
            clearTimeout(timer);
            return entry ? { state: 'miss', entry } : { state: 'busy', entry: null };
        },
        stats: () => ({ entries: cache.size, bytes: totalBytes, queued: queue.length, active, breakerOpen: now() < openUntil }),
    };
}
