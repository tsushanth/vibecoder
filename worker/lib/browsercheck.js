// Runtime check: load the app in a headless browser, fill inputs, click every control, and report uncaught page errors.
// Fails open: if no browser is configured or the harness itself breaks, the build is not blocked.
import path from 'node:path';
import { staticChecks } from './checks.js';
import { injectSdk, loadVibeSdk, usesBackendSdk, usesDeviceSdk } from './vibe.js';
import { DEVICE_FAKE_SCRIPT, FAKE_SCRIPT } from './vibeFake.js';

const CONTROLS = 'button,[role=button],input[type=submit],a[href^="#"],[onclick]';

// The app under check is untrusted code. It is served from memory on a made-up web origin, so the browser gives it no access
// to local files, and nothing it requests leaves the browser.
export const CHECK_ORIGIN = 'https://app.check.invalid';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
// All traffic, loopback included, goes to a proxy that does not exist. This also covers what request interception does not
// see (WebSockets, pop-ups, workers).
const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];

async function serveFromMemory(page, files) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const answer = () => {
            const url = new URL(req.url());
            if (url.protocol === 'data:' || url.protocol === 'blob:') return req.continue();
            if (url.origin !== CHECK_ORIGIN) return req.abort('blockedbyclient');
            const name = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
            if (!Object.hasOwn(files, name)) return req.respond({ status: 404, contentType: 'text/plain', body: 'not found' });
            return req.respond({ status: 200, contentType: `${TYPES[path.extname(name).toLowerCase()] || 'text/plain'}; charset=utf-8`, body: files[name] });
        };
        Promise.resolve().then(answer).catch(() => req.abort().catch(() => {}));
    });
}

export async function runtimeProblems(files, { chrome = process.env.CHROME_PATH, timeoutMs = 25000, maxClicks = 40 } = {}) {
    if (!chrome) return [];
    let puppeteer;
    try { puppeteer = (await import('puppeteer-core')).default; } catch { console.warn('[browsercheck] puppeteer-core missing, build not checked'); return []; }
    let browser;
    const errs = [];
    try {
        browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: LAUNCH_ARGS });
        const page = await browser.newPage();
        await serveFromMemory(page, files);
        page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
        // unhandled promise rejections from the vibe SDK (e.g. an unguarded vibe.ai.ask) are real bugs; other rejections (audio.play and friends) are not reported
        await page.evaluateOnNewDocument(() => { window.__vbRej = []; window.addEventListener('unhandledrejection', (e) => { window.__vbRej.push(String((e.reason && e.reason.message) || e.reason).slice(0, 120)); }); });
        page.on('dialog', (d) => d.dismiss().catch(() => {}));
        const work = (async () => {
            await page.goto(`${CHECK_ORIGIN}/index.html`, { waitUntil: 'load', timeout: 12000 });
            await new Promise((r) => setTimeout(r, 400));
            await page.evaluate(() => {
                document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),textarea').forEach((i) => {
                    const t = i.type;
                    i.value = t === 'number' ? '5' : t === 'email' ? 'a@b.co' : t === 'date' ? '2026-01-15' : t === 'password' ? 'Passw0rd!' : 'Test';
                    i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
                });
                document.querySelectorAll('select').forEach((s) => { if (s.options.length > 1) s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); });
            });
            const total = await page.evaluate((sel) => document.querySelectorAll(sel).length, CONTROLS);
            for (let i = 0; i < Math.min(total, maxClicks); i++) {
                await page.evaluate((sel, i) => { const e = document.querySelectorAll(sel)[i]; const r = e && e.getBoundingClientRect(); if (r && r.width && r.height) e.click(); }, CONTROLS, i).catch(() => {});
                await new Promise((r) => setTimeout(r, 50));
            }
            if (files['vibe.js']) {
                await new Promise((r) => setTimeout(r, 900)); // let in-flight SDK calls settle
                for (const m of await page.evaluate(() => window.__vbRej || [])) {
                    if (!/^vibe/i.test(m)) continue;
                    const hinted = `unhandled promise rejection from the vibe SDK: ${m}. Catch errors from vibe.api and vibe.ai (and from vibe.auth, vibe.db, vibe.storage, vibe.pay, vibe.notify and vibe.device calls) and show a friendly message`;
                    const dup = errs.findIndex((e) => e.includes(m)); // Chrome may already have reported it as a page error
                    if (dup >= 0) errs[dup] = hinted; else errs.push(hinted);
                }
            }
        })();
        await Promise.race([work, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
    } catch (e) {
        if (!errs.length) { console.warn(`[browsercheck] unavailable, build not checked: ${String(e.message).slice(0, 120)}`); return []; } // harness trouble, not an app bug
    } finally {
        try { await browser?.close(); } catch { /* ignore */ }
    }
    return [...new Set(errs)].slice(0, 3).map((m) => `runtime error when the page loads or a control is clicked: ${m}`);
}

/** The files the browser check loads: the app as it will ship, plus the real SDK. Accounts, tables and uploads run against an
 *  in-memory fake in the check, so no network call is made and none can fail the app. vibe.api and vibe.ai stay real. */
export function filesForRun(files, { vibe = false, sdk = loadVibeSdk() } = {}) {
    const out = injectSdk(files, { sdk, enabled: vibe });
    if (out['vibe.js'] && usesBackendSdk(files)) out['vibe.js'] += FAKE_SCRIPT;
    if (out['vibe.js'] && usesDeviceSdk(files)) out['vibe.js'] += DEVICE_FAKE_SCRIPT;
    return out;
}

/** Static checks first (cheap), then the browser check. Async; usable as generateApp's `check`.
 *  opts.vibe: the vibe proxy SDK is enabled. The browser check then runs the app with the real vibe.js injected. */
export async function fullChecks(files, opts = {}) {
    const { vibe = false, ...runtimeOpts } = opts;
    const s = staticChecks(files, { vibe });
    if (!s.ok) return s;
    const runFiles = filesForRun(files, { vibe });
    const problems = await runtimeProblems(runFiles, runtimeOpts);
    return problems.length ? { ok: false, hasApp: true, problems } : s;
}
