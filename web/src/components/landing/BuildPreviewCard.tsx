// A stylized replica of the actual chat-build flow (see the Android
// BuildChat screen), not a generic browser-chrome mockup, so the hero shows
// the real product instead of a decorative stand-in. Intentionally dark —
// it's the app's own dark builder UI (bg-background/border-border/etc. here
// are the app's real semantic dark tokens, unscoped on purpose), floating
// as a screenshot on the light marketing page, like Replit's own product
// shots. The accent uses the literal violet #5B4CFF (VibeBuild's real
// brand mark) rather than bg-accent, which is the dark theme's blue.
export function BuildPreviewCard() {
  const phases = ['Generate', 'Validate', 'Fix', 'Polish', 'Verify'];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#e8846b]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#e3c15c]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#7fae7a]" />
        </div>
        <span className="flex-1 text-center font-mono text-xs text-subtle">habit-tracker.vibebuild.cc</span>
      </div>

      <div className="grid grid-cols-1 gap-0 sm:grid-cols-2">
        <div className="space-y-4 border-b border-border p-5 sm:border-b-0 sm:border-r">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-[#5B4CFF] px-4 py-2.5 text-sm text-white">
            Build a habit tracker with streaks and weekly progress
          </div>

          <div className="rounded-2xl rounded-tl-sm border border-border bg-background p-4">
            <p className="mb-2 text-sm font-semibold">Here&apos;s my plan</p>
            <ul className="space-y-1.5 text-sm text-muted">
              <li>Daily habit list with one-tap check-in</li>
              <li>Streak counter per habit</li>
              <li>Weekly progress chart</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-background p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Building your app</p>
              <span className="font-mono text-xs text-subtle">0:34</span>
            </div>
            <ul className="space-y-2">
              {phases.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm text-muted">
                  <svg className="h-4 w-4 shrink-0 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex h-40 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B4CFF]/25 to-[#8f7fff]/10">
            <span className="text-4xl font-semibold text-[#5B4CFF]/60">HT</span>
          </div>
          <p className="text-sm font-semibold">Build complete</p>
          <div className="flex gap-2">
            <span className="flex-1 rounded-full bg-[#5B4CFF] px-3 py-2 text-center text-sm font-semibold text-white">
              Open live preview
            </span>
            <span className="rounded-full border border-border px-3 py-2 text-sm text-muted">Tweak</span>
          </div>
        </div>
      </div>
    </div>
  );
}
