'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Real starter prompts, matching the labels shipped in the product's own
// suggestion list (backend/routes/projects.routes.js) so this isn't invented copy.
const CHIPS = [
  { label: 'Habit tracker', prompt: 'Build a habit tracking app where each habit grows a virtual plant based on consistency, with streak counters and weekly progress charts' },
  { label: 'Quiz game', prompt: 'Build an interactive quiz game with multiple choice questions, score tracking, a timer, and a results screen with a share button' },
  { label: 'Portfolio site', prompt: 'Build a personal portfolio website with a dark theme, animated hero section, project gallery with hover effects, and a working contact form' },
  { label: 'Recipe finder', prompt: 'Build a recipe search app with ingredient-based filtering, step-by-step cooking instructions, and the ability to save favorites' },
];

export function PromptHero() {
  const [prompt, setPrompt] = useState('');
  const router = useRouter();

  function go() {
    const q = prompt.trim();
    router.push(q ? `/signup?prompt=${encodeURIComponent(q)}` : '/signup');
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-[#17140F]/12 bg-white p-2 shadow-[0_1px_2px_rgba(23,20,15,0.04)]">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              go();
            }
          }}
          rows={2}
          placeholder="Build a pomodoro timer with a task list and a focus streak"
          className="w-full resize-none bg-transparent px-4 py-3 font-mono text-[15px] text-[#17140F] outline-none placeholder:font-sans"
        />
        <div className="flex items-center justify-end px-2 pb-1">
          <button
            onClick={go}
            className="rounded-full bg-[#5B4CFF] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#4638D6]"
          >
            Build it
          </button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            onClick={() => setPrompt(c.prompt)}
            className="rounded-full border border-[#17140F]/12 px-3.5 py-1.5 text-sm text-[#17140F]/62 transition hover:border-[#5B4CFF]/40 hover:text-[#17140F]"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
