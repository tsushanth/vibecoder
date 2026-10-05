// In-memory sliding-window limiter. Per process: counts reset when the process restarts or is replaced.
export function createWindowLimiter({ windowMs, max, maxKeys = 10_000, now = () => Date.now() }) {
    const events = new Map(); // key -> ascending timestamps within the window

    const prune = (key) => {
        const list = events.get(key);
        if (!list) return null;
        const cutoff = now() - windowMs;
        let i = 0;
        while (i < list.length && list[i] <= cutoff) i += 1;
        if (i) list.splice(0, i);
        if (!list.length) { events.delete(key); return null; }
        return list;
    };

    return {
        /** Records an event and returns true if it is within the limit; a refused event is not recorded. */
        hit(key) {
            const list = prune(key) || [];
            if (list.length >= max) return false;
            list.push(now());
            events.delete(key); events.set(key, list); // most recently used last
            while (events.size > maxKeys) events.delete(events.keys().next().value);
            return true;
        },
        count(key) { return prune(key)?.length || 0; },
        retryAfterMs(key) {
            const list = prune(key);
            return list && list.length >= max ? Math.max(0, list[0] + windowMs - now()) : 0;
        },
        size() { return events.size; },
        sweep() { for (const key of [...events.keys()]) prune(key); },
    };
}
