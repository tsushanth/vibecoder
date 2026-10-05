// Per-app usage metering. Events carry counts and sizes only: never secrets, query values or bodies.
export function createMeter({ sink, now = () => Date.now() }) {
    return {
        now,
        async record({ appId, connector, status, outcome, requestBytes = 0, responseBytes = 0, ms = 0 }) {
            const t = now();
            const event = { ts: new Date(t).toISOString(), day: new Date(t).toISOString().slice(0, 10), appId, connector, status, outcome, requestBytes, responseBytes, ms };
            try { await sink(event); } catch { /* metering must never break a request */ }
            return event;
        },
    };
}

export function summarize(events) {
    const out = {};
    for (const e of events) {
        const s = (out[e.connector] ||= { calls: 0, errors: 0, responseBytes: 0 });
        s.calls += 1;
        if (e.status >= 400) s.errors += 1;
        s.responseBytes += e.responseBytes || 0;
    }
    return out;
}
