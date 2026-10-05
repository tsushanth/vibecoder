// The in-process scheduler loop. Runs tick() every tickMs, never two ticks at once, never throws, and stops cleanly:
// stop() resolves once the tick in flight (if any) has finished.
export function startScheduler({ tickMs = 30_000, tick, onError = () => {} }) {
    if (typeof tick !== 'function') throw new Error('startScheduler needs a tick function');
    if (!Number.isInteger(tickMs) || tickMs < 10) throw new Error('tickMs must be an integer of at least 10');
    let stopped = false; let timer = null; let inflight = null;

    const schedule = () => { if (!stopped) { timer = setTimeout(loop, tickMs); timer.unref?.(); } };
    const loop = () => {
        timer = null;
        inflight = (async () => { try { await tick(); } catch (e) { try { onError(e); } catch { /* a failing logger must not stop the loop */ } } })()
            .finally(() => { inflight = null; schedule(); });
    };
    schedule();

    return {
        async stop() {
            stopped = true;
            if (timer) { clearTimeout(timer); timer = null; }
            if (inflight) await inflight;
        },
    };
}
