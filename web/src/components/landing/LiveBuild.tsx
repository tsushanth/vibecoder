'use client';

import { useEffect, useState } from 'react';

// The one moment of motion on the page: an example app assembling itself while the build steps tick over, once on load.
// It is an illustration of a build, not a screenshot of a real one, and says so. Reduced motion shows the finished state.
const STEPS = ['Planning the screens', 'Writing the app', 'Checking that it runs', 'Live'];

const HABITS = [
  { name: 'Drink water', streak: 6, done: true },
  { name: 'Read 20 minutes', streak: 3, done: true },
  { name: 'Stretch', streak: 9, done: false },
];
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function LiveBuild() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setStage(4); return; }
    setStage(0);
    const timers = [1, 2, 3, 4].map((n) => window.setTimeout(() => setStage(n), 700 + n * 800));
    return () => timers.forEach(window.clearTimeout);
  }, []);

  const show = (n: number) => (stage >= n ? 'opacity-100' : 'opacity-0');

  return (
    <figure className="mx-auto w-full max-w-[340px]" aria-label="An example app being built">
      <div className="rounded-[28px] border border-border bg-[#0A1020] p-2.5 shadow-[0_30px_80px_-30px_rgba(108,99,255,0.45)]">
        <div className="relative aspect-[9/15.5] overflow-hidden rounded-[20px] bg-[#F6F4FF] text-[#1B1740]">
          <div className={`px-5 pt-6 transition-opacity duration-500 ${show(1)}`}>
            <p className="text-[13px] text-[#6C63FF]">Today</p>
            <h3 className="font-display text-[26px] font-bold leading-tight">Habits</h3>
          </div>
          <div className={`mt-4 flex justify-between px-5 transition-opacity duration-500 ${show(2)}`}>
            {DAYS.map((d, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5 text-[11px] text-[#6B6890]">
                {d}
                <span className={`h-6 w-6 rounded-full ${i < 5 ? 'bg-[#6C63FF]' : 'border border-[#CFCBF5]'}`} />
              </div>
            ))}
          </div>
          <ul className={`mt-5 space-y-2.5 px-4 transition-opacity duration-500 ${show(3)}`}>
            {HABITS.map((h) => (
              <li key={h.name} className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(27,23,64,0.08)]">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${h.done ? 'border-[#6C63FF] bg-[#6C63FF]' : 'border-[#CFCBF5]'}`}>
                  {h.done && <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="white" strokeWidth="2"><path d="m2.5 6.2 2.3 2.3 4.7-5" /></svg>}
                </span>
                <span className="flex-1 text-[14px] font-medium">{h.name}</span>
                <span className="text-[12px] text-[#6B6890]">{h.streak} days</span>
              </li>
            ))}
          </ul>
          <div className={`absolute inset-x-4 bottom-4 rounded-xl bg-[#6C63FF] py-3 text-center text-[14px] font-semibold text-white transition-opacity duration-500 ${show(3)}`}>
            Add a habit
          </div>
        </div>
      </div>
      <figcaption className="mt-5 text-sm">
        <ol className="space-y-1.5">
          {STEPS.map((label, i) => {
            const state = stage > i ? 'done' : stage === i ? 'now' : 'wait';
            const last = i === STEPS.length - 1;
            return (
              <li key={label} className={`flex items-center gap-2.5 transition-colors duration-300 ${state === 'wait' ? 'text-subtle' : 'text-foreground'}`}>
                <span className={`h-2 w-2 rounded-full ${state === 'wait' ? 'bg-border' : last ? 'bg-success' : 'bg-accent-hover'}`} />
                {last && state !== 'wait' ? <span><span className="font-medium text-success">Live</span> at habit-tracker.vibebuild.cc</span> : label}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-subtle">An example of a build, sped up.</p>
      </figcaption>
    </figure>
  );
}
