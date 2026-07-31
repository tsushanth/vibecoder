/**
 * recover-failed-builds.mjs
 *
 * Finds all failed projects with an initial_prompt, rebuilds them via the worker,
 * and sends push notifications when done via the existing build-complete callback.
 *
 * Usage:
 *   node recover-failed-builds.mjs [--dry-run] [--limit=50] [--concurrency=2]
 *
 * The script dispatches builds with callbackUrl pointing to the backend's
 * /api/projects/:id/build-complete endpoint, which updates the DB and sends
 * push notifications automatically.
 */

import { createClient } from '../backend/node_modules/@supabase/supabase-js/dist/index.mjs';

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL    = process.env.SUPABASE_URL    || 'https://owvvrljdfnhntwedepkl.supabase.co';
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY; // must be service role
const WORKER_URL      = process.env.WORKER_URL      || 'http://178.156.231.255:3456';
const WORKER_SECRET   = process.env.WORKER_SECRET   || 'vibecoder-worker-secret-2024';

// Local machine workers (connected via reverse SSH tunnel from VM)
// Add Mac Mini here once tunnel is set up: 'http://localhost:3472'
const LOCAL_WORKER_PORTS = (process.env.LOCAL_WORKER_PORTS || '3471').split(',').map(p => `http://localhost:${p.trim()}`);
const BACKEND_URL     = process.env.BACKEND_URL     || 'https://vibecoder-api.fly.dev';
const DRY_RUN         = process.argv.includes('--dry-run');
const LIMIT           = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '200');
const CONCURRENCY     = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '2');
const DELAY_MS        = 30000; // 30s between batches — health check will gate actual dispatch

if (!SUPABASE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY env var required');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Round-robin index for local workers
let localWorkerIndex = 0;

async function dispatchBuild(project) {
    const callbackUrl = `${BACKEND_URL}/api/projects/${project.id}/build-complete`;
    const body = {
        prompt: project.initial_prompt,
        userId: project.creator_id,
        framework: 'react',
        stream: false,
        projectId: project.id,
        callbackUrl,
        callbackSecret: WORKER_SECRET,
    };

    // Try local workers first (free Claude creds, never expire), then VM
    const workerUrls = [...LOCAL_WORKER_PORTS, WORKER_URL];

    for (const workerUrl of workerUrls) {
        // Check if this worker has capacity
        const health = await fetch(`${workerUrl}/health`).then(r => r.json()).catch(() => null);
        if (!health?.healthy || health.activeGenerations >= health.maxConcurrent) continue;

        try {
            const res = await fetch(`${workerUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-worker-secret': WORKER_SECRET },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15000),
            });
            return { status: res.status, ok: res.ok, body: await res.text().catch(() => ''), worker: workerUrl };
        } catch (err) {
            console.log(`    ↩ Worker ${workerUrl} failed: ${err.message}, trying next`);
        }
    }

    return { status: 503, ok: false, body: 'All workers busy or unreachable', worker: 'none' };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🔧 VibeBuild Failed Build Recovery`);
    console.log(`   Worker:      ${WORKER_URL}`);
    console.log(`   Backend:     ${BACKEND_URL}`);
    console.log(`   Limit:       ${LIMIT}`);
    console.log(`   Concurrency: ${CONCURRENCY}`);
    console.log(`   Dry run:     ${DRY_RUN}\n`);

    // Fetch all failed projects that have a prompt
    const { data: projects, error } = await supabase
        .from('projects')
        .select('id, title, creator_id, initial_prompt, created_at')
        .eq('status', 'failed')
        .not('initial_prompt', 'is', null)
        .not('creator_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(LIMIT);

    if (error) { console.error('❌ Supabase error:', error.message); process.exit(1); }

    console.log(`📋 Found ${projects.length} failed projects to recover\n`);

    if (DRY_RUN) {
        projects.forEach((p, i) => console.log(`  ${i+1}. [${p.id}] "${p.title}" (user: ${p.creator_id})`));
        console.log('\n✅ Dry run complete — no changes made');
        return;
    }

    // Check worker health first
    const health = await fetch(`${WORKER_URL}/health`).then(r => r.json()).catch(() => null);
    if (!health?.healthy) { console.error('❌ Worker not healthy, aborting'); process.exit(1); }
    console.log(`✅ Worker healthy (active: ${health.activeGenerations}/${health.maxConcurrent})\n`);

    let dispatched = 0, skipped = 0, failed = 0;

    // Process in batches of CONCURRENCY
    for (let i = 0; i < projects.length; i += CONCURRENCY) {
        const batch = projects.slice(i, i + CONCURRENCY);

        // Check aggregate capacity across all workers (VM Docker workers + local machine workers via reverse SSH tunnel)
        const VM_PORTS = [3461, 3462, 3467, 3468, 3469, 3470];
        const vmHost = WORKER_URL.replace(/:\d+$/, '');
        const ALL_WORKER_URLS = [
            ...VM_PORTS.map(p => `${vmHost}:${p}`),
            ...LOCAL_WORKER_PORTS,  // local machines via reverse SSH tunnel
        ];
        let totalFree = 0, workerReady = false;
        for (let attempt = 0; attempt < 20; attempt++) {
            totalFree = 0;
            for (const url of ALL_WORKER_URLS) {
                const h = await fetch(`${url}/health`).then(r => r.json()).catch(() => null);
                if (h) totalFree += Math.max(0, h.maxConcurrent - h.activeGenerations);
            }
            if (totalFree >= CONCURRENCY) { workerReady = true; break; }
            console.log(`  ⏳ Only ${totalFree} free slots across ${ALL_WORKER_URLS.length} workers, waiting 30s...`);
            await sleep(30000);
        }
        if (!workerReady) { console.log(`  ❌ Workers still busy after wait, skipping batch`); continue; }

        const results = await Promise.all(batch.map(async (project) => {
            try {
                const result = await dispatchBuild(project);
                if (result.ok) {
                    await supabase.from('projects').update({ status: 'building' }).eq('id', project.id);
                    console.log(`  ✅ [${i + batch.indexOf(project) + 1}/${projects.length}] Dispatched: "${project.title?.substring(0,40)}" (${project.id.substring(0,8)})`);
                    return 'dispatched';
                } else if (result.status === 429) {
                    console.log(`  ⏳ Worker busy for ${project.id.substring(0,8)} — retrying next round`);
                    return 'busy';
                } else {
                    console.log(`  ❌ Worker error ${result.status} for ${project.id.substring(0,8)}: ${result.body.substring(0,100)}`);
                    return 'error';
                }
            } catch (err) {
                console.log(`  ❌ Fetch error for ${project.id.substring(0,8)}: ${err.message}`);
                return 'error';
            }
        }));

        dispatched += results.filter(r => r === 'dispatched').length;
        skipped    += results.filter(r => r === 'busy').length;
        failed     += results.filter(r => r === 'error').length;

        // Wait between batches so the worker doesn't get slammed
        if (i + CONCURRENCY < projects.length) {
            process.stdout.write(`  ⏸  Waiting ${DELAY_MS/1000}s before next batch...\r`);
            await sleep(DELAY_MS);
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Dispatched: ${dispatched}`);
    console.log(`   Worker busy (left as building): ${skipped}`);
    console.log(`   Errors: ${failed}`);
    console.log(`\n💬 Users will receive push notifications when their builds complete.\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
