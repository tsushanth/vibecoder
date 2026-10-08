'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';

// Real starter prompts, matching the labels shipped in the product's own suggestion list (backend/routes/projects.routes.js).
const CHIPS = [
  { label: 'Habit tracker', prompt: 'Build a habit tracking app where each habit grows a virtual plant based on consistency, with streak counters and a weekly view' },
  { label: 'Quiz game', prompt: 'Build an interactive quiz game with multiple choice questions, score tracking, a timer, and a results screen with a share button' },
  { label: 'Portfolio site', prompt: 'Build a personal portfolio website with a dark theme, an animated hero section, a project gallery with hover effects, and a contact form' },
  { label: 'Recipe finder', prompt: 'Build a recipe search app with ingredient-based filtering, step-by-step cooking instructions, and the ability to save favourites' },
];

/** The landing page's prompt box. The text is kept in sessionStorage across sign-up so the Create page can pick it up. */
export function HeroComposer() {
  const [prompt, setPrompt] = useState('');
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  function go() {
    const q = prompt.trim();
    try { if (q) sessionStorage.setItem('vb_pending_prompt', q); } catch { /* storage blocked: the person types it again */ }
    router.push(user ? '/project/new' : '/signup');
  }

  return (
    <div className="w-full max-w-xl">
      <div className="rounded-2xl border border-border bg-card p-2 focus-within:border-accent/70">
        <label htmlFor="hero-prompt" className="sr-only">Describe the app you want</label>
        <textarea
          id="hero-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
          }}
          rows={3}
          placeholder="A pomodoro timer with a task list and a focus streak"
          className="w-full resize-none bg-transparent px-3 py-2.5 text-base text-foreground outline-none placeholder:text-muted/70"
        />
        <div className="flex justify-end px-1 pb-1">
          <button onClick={go} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hover">
            Build it
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Starting points">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            onClick={() => setPrompt(c.prompt)}
            className="rounded-lg border border-border px-3.5 py-2 text-sm text-muted transition hover:border-accent/60 hover:text-foreground"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
