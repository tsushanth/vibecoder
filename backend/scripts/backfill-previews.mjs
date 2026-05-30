// One-shot backfill: deploys previews + captures thumbnails for projects that
// missed it due to the build-complete /deploy-preview bug (fixed 2026-05-15).
//
// Run from backend/ directory:
//   node scripts/backfill-previews.mjs              # dry-run (counts only)
//   node scripts/backfill-previews.mjs --apply      # do the work
//   node scripts/backfill-previews.mjs --apply --limit 20   # process N then stop
//
// Idempotent: only touches rows where preview_url IS NULL.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const DEPLOY_SERVER_URL = 'https://vibecoder-deploy.fly.dev';
const SCREENSHOT_SERVICE_URL = 'http://178.156.231.255:3465';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limitFlag = args.indexOf('--limit');
const LIMIT = limitFlag >= 0 ? parseInt(args[limitFlag + 1], 10) : Infinity;
const CONCURRENCY = 4;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function deployPreview(id, bundle) {
    const subdomain = `prev-${id.substring(0, 8)}`;
    const res = await fetch(`${DEPLOY_SERVER_URL}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, bundle }),
        signal: AbortSignal.timeout(45000)
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`deploy HTTP ${res.status}: ${body.substring(0, 150)}`);
    }
    return { subdomain, previewUrl: `https://${subdomain}.vibecoder.app` };
}

function thumbnailUrlFor(previewUrl) {
    // Use the screenshot service URL directly as the thumbnail.
    // Client renders on demand. Avoids needing the screenshot service to be reachable
    // from wherever this script runs, and avoids the Supabase Storage upload path.
    return `${SCREENSHOT_SERVICE_URL}/screenshot?url=${encodeURIComponent(previewUrl)}&width=390&height=844`;
}

async function processOne(p) {
    try {
        const { previewUrl } = await deployPreview(p.id, p.bundle);
        const thumbnailUrl = thumbnailUrlFor(previewUrl);
        await supabase.from('projects')
            .update({ preview_url: previewUrl, thumbnail_url: thumbnailUrl })
            .eq('id', p.id);
        return { ok: true, id: p.id, previewUrl };
    } catch (err) {
        return { ok: false, id: p.id, error: err.message };
    }
}

async function main() {
    // Fetch candidates. preview_url is null AND bundle is not null AND status='ready'.
    const { data: candidates, error, count } = await supabase
        .from('projects')
        .select('id, title, creator_name, bundle', { count: 'exact' })
        .eq('status', 'ready')
        .is('preview_url', null)
        .not('bundle', 'is', null)
        .order('created_at', { ascending: false })
        .limit(Math.min(LIMIT, 500));
    if (error) throw error;

    console.log(`Found ${count} ready projects with no preview_url. Will process ${candidates.length}.`);
    if (!APPLY) {
        console.log('Dry-run. Pass --apply to do the work.');
        candidates.slice(0, 5).forEach(p => console.log(`  ${p.id} | ${p.creator_name?.substring(0, 20)} | ${p.title?.substring(0, 50)}`));
        if (candidates.length > 5) console.log(`  ... and ${candidates.length - 5} more`);
        return;
    }

    let okCount = 0, failCount = 0, idx = 0;
    const queue = [...candidates];

    async function worker() {
        while (queue.length) {
            const p = queue.shift();
            const i = ++idx;
            const t0 = Date.now();
            const r = await processOne(p);
            const dt = ((Date.now() - t0) / 1000).toFixed(1);
            if (r.ok) {
                okCount++;
                console.log(`[${i}/${candidates.length}] ✓ ${r.id} (${dt}s)`);
            } else {
                failCount++;
                console.log(`[${i}/${candidates.length}] ✗ ${r.id} (${dt}s): ${r.error}`);
            }
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    console.log(`\nDone. ok=${okCount} fail=${failCount} total=${candidates.length}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
