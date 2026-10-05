// Replay real (redacted) user prompts through the direct generator and report completion rate.
// Reads public.replay_prompts from Supabase with the service role. Run on a dev machine, never in the worker.
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... OPENROUTER_API_KEY=... node worker/scripts/replay.mjs
// Optional: REPLAY_CHROME=/path/to/chrome and puppeteer-core installed -> also loads each app and reports page errors.
// Exit code 1 when completion is below THRESHOLD (default 0.8).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OpenRouterClient } from '../lib/llm.js';
import { generateApp } from '../lib/generate.js';
import { scrubSecrets } from '../lib/scrub.js';
import { writeFiles } from '../lib/files.js';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENROUTER_API_KEY, REPLAY_FILE } = process.env;
if (!OPENROUTER_API_KEY || (!REPLAY_FILE && (!SUPABASE_URL || !SUPABASE_SERVICE_KEY))) {
    console.error('need OPENROUTER_API_KEY and either REPLAY_FILE or SUPABASE_URL + SUPABASE_SERVICE_KEY');
    process.exit(2);
}
const THRESHOLD = parseFloat(process.env.THRESHOLD || '0.8');
const CONC = parseInt(process.env.CONC || '3', 10);
const BUDGET = parseFloat(process.env.BUDGET_USD || '2');
const models = (process.env.DIRECT_MODELS || 'openai/gpt-5.6-luna,moonshotai/kimi-k2.7-code,deepseek/deepseek-v4-pro').split(',');
const rules = 'You are building a self-contained web app. Single index.html; no external resources.';

let rows;
if (REPLAY_FILE) {
    // local JSON export of the table: [{id, text|prompt, prod_outcome?}]
    rows = JSON.parse(fs.readFileSync(REPLAY_FILE, 'utf8')).map((x) => ({ id: x.id, prompt: x.prompt ?? x.text, prod_outcome: x.prod_outcome }));
} else {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/replay_prompts?select=id,prompt,prod_outcome&order=id`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
    if (!res.ok) { console.error('fetch replay_prompts failed:', res.status); process.exit(2); }
    rows = await res.json();
}
console.log(`replaying ${rows.length} prompts, models ${models.map((m) => m.split('/')[1]).join(' > ')}, budget $${BUDGET}`);

const llm = new OpenRouterClient({ apiKey: OPENROUTER_API_KEY, dailyBudgetUsd: BUDGET });
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-replay-'));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < rows.length) {
        const row = rows[next++];
        const t0 = Date.now();
        let r;
        try { r = await generateApp({ prompt: scrubSecrets(row.prompt), llm, models, rules }); }
        catch (e) { r = { ok: false, cause: 'exception', costUsd: 0 }; }
        const rec = { id: row.id, prod: row.prod_outcome, ok: r.ok, cause: r.cause || 'ok', model: r.model, costUsd: r.costUsd || 0, secs: Math.round((Date.now() - t0) / 1000) };
        if (r.ok) { const dir = path.join(out, row.id); fs.mkdirSync(dir, { recursive: true }); writeFiles(dir, r.files); }
        results.push(rec);
        console.log(`${rec.id} ${rec.ok ? 'OK  ' : 'FAIL'} ${rec.cause} (prod was ${rec.prod}) $${rec.costUsd.toFixed(3)} ${rec.secs}s`);
    }
}));

if (process.env.REPLAY_CHROME) {
    try {
        const { default: puppeteer } = await import('puppeteer-core');
        const browser = await puppeteer.launch({ executablePath: process.env.REPLAY_CHROME, headless: true, args: ['--allow-file-access-from-files', '--no-sandbox'] });
        for (const rec of results.filter((x) => x.ok)) {
            const page = await browser.newPage();
            const errs = [];
            page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 100)));
            try {
                await page.goto('file://' + path.join(out, rec.id, 'index.html'), { waitUntil: 'load', timeout: 15000 });
                await new Promise((r) => setTimeout(r, 600));
                rec.bodyChars = await page.evaluate(() => (document.body.innerText || '').trim().length);
            } catch (e) { errs.push('goto: ' + String(e.message).slice(0, 80)); }
            rec.loadErrors = errs;
            await page.close();
        }
        await browser.close();
    } catch (e) { console.log('browser check skipped:', String(e.message).slice(0, 80)); }
}

const n = results.length;
const ok = results.filter((x) => x.ok).length;
const clean = results.filter((x) => x.ok && (x.loadErrors === undefined || (!x.loadErrors.length && x.bodyChars > 20))).length;
const cost = results.reduce((a, x) => a + x.costUsd, 0);
const causes = {}; for (const x of results) causes[x.cause] = (causes[x.cause] || 0) + 1;
console.log(`\ncompletion ${ok}/${n} = ${(100 * ok / n).toFixed(0)}%  (loads clean: ${clean})  cost $${cost.toFixed(2)}  causes ${JSON.stringify(causes)}`);
console.log(`apps kept in ${out}`);
process.exit(ok / n >= THRESHOLD ? 0 : 1);
