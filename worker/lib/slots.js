// Concurrency slots for the build endpoints. acquire() returns a release function that is idempotent: the old code did
// `activeGenerations = Math.max(0, activeGenerations - 1)` on an early-return path AND again in `finally`, so one build
// released twice. Clamping at zero hid the negative number but a second release still stole another running build's slot,
// letting more than MAX_CONCURRENT builds run at once (RiddleVerse's copy of this worker drifted to -18 in production).
export function createSlotTracker(max, onAnomaly = () => {}) {
    let active = 0;
    return {
        get active() { return active; },
        max,
        full: () => active >= max,
        acquire() {
            active++;
            let released = false;
            return function release() {
                if (released) { onAnomaly('double_release'); return; }
                released = true;
                active--;
                if (active < 0) { active = 0; onAnomaly('negative'); }
            };
        },
    };
}
