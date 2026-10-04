// Synthetic probe: ask a running worker to build one tiny app and confirm a usable result comes back.
// For cron or monitoring. Costs about one cent per run when direct generation is on.
//   WORKER_URL=http://127.0.0.1:3456 WORKER_SECRET=... node worker/scripts/probe.mjs
// Exit 0 = healthy, 1 = build failed or returned nothing, 2 = misconfigured. Prints one JSON line.
const base = process.env.WORKER_URL || 'http://127.0.0.1:3456';
const secret = process.env.WORKER_SECRET;
if (!secret) { console.error('need WORKER_SECRET'); process.exit(2); }
const t0 = Date.now();
const line = (o) => console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'probe', ms: Date.now() - t0, ...o }));
try {
    const health = await (await fetch(`${base}/health`)).json();
    const r = await fetch(`${base}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-worker-secret': secret },
        body: JSON.stringify({ prompt: 'A page with one button labelled Add that increments a visible counter. Probe build, keep it tiny.', userId: 'probe', stream: true }),
        signal: AbortSignal.timeout(540000),
    });
    const text = await r.text();
    let ev = null;
    for (const chunk of text.split('\n\n')) {
        const l = chunk.split('\n').find((x) => x.startsWith('data: '));
        if (!l) continue;
        try { const j = JSON.parse(l.slice(6)); if (j.type === 'result' || j.type === 'error') ev = j; } catch { /* partial line */ }
    }
    const ok = ev?.type === 'result' && (ev.files || []).length > 0;
    line({ ok, generator: ev?.generator, model: ev?.model, files: (ev?.files || []).length, error: ev?.error ? String(ev.error).slice(0, 120) : undefined, directPercent: health.direct?.percent, breakersOpen: health.direct?.breakersOpen });
    process.exit(ok ? 0 : 1);
} catch (e) {
    line({ ok: false, error: String(e.message).slice(0, 120) });
    process.exit(1);
}
