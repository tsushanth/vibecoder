// Runtime check: load the app in a headless browser, fill inputs, click every control, and report uncaught page errors.
// Fails open: if no browser is configured or the harness itself breaks, the build is not blocked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFiles } from './files.js';
import { staticChecks } from './checks.js';
import { injectSdk, loadVibeSdk, usesBackendSdk } from './vibe.js';
import { FAKE_SCRIPT } from './vibeFake.js';

const CONTROLS = 'button,[role=button],input[type=submit],a[href^="#"],[onclick]';

export async function runtimeProblems(files, { chrome = process.env.CHROME_PATH, timeoutMs = 25000, maxClicks = 40 } = {}) {
    if (!chrome) return [];
    let puppeteer;
    try { puppeteer = (await import('puppeteer-core')).default; } catch { console.warn('[browsercheck] puppeteer-core missing, build not checked'); return []; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-rt-'));
    let browser;
    const errs = [];
    try {
        writeFiles(dir, files);
        browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--allow-file-access-from-files', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
        const page = await browser.newPage();
        page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
        // unhandled promise rejections from the vibe SDK (e.g. an unguarded vibe.ai.ask) are real bugs; other rejections (audio.play and friends) are not reported
        await page.evaluateOnNewDocument(() => { window.__vbRej = []; window.addEventListener('unhandledrejection', (e) => { window.__vbRej.push(String((e.reason && e.reason.message) || e.reason).slice(0, 120)); }); });
        page.on('dialog', (d) => d.dismiss().catch(() => {}));
        const work = (async () => {
            await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load', timeout: 12000 });
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
                    const hinted = `unhandled promise rejection from the vibe SDK: ${m}. Catch errors from vibe.api and vibe.ai (and from vibe.auth, vibe.db and vibe.storage calls) and show a friendly message`;
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
        fs.rmSync(dir, { recursive: true, force: true });
    }
    return [...new Set(errs)].slice(0, 3).map((m) => `runtime error when the page loads or a control is clicked: ${m}`);
}

/** The files the browser check loads: the app as it will ship, plus the real SDK. Accounts, tables and uploads run against an
 *  in-memory fake in the check, so no network call is made and none can fail the app. vibe.api and vibe.ai stay real. */
export function filesForRun(files, { vibe = false, sdk = loadVibeSdk() } = {}) {
    const out = injectSdk(files, { sdk, enabled: vibe });
    if (out['vibe.js'] && usesBackendSdk(files)) out['vibe.js'] += FAKE_SCRIPT;
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
