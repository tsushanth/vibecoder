'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGenerationStore } from '@/stores/generationStore';

// The build pipeline's phases, in order, as the generation SSE `status` events name them.
const PHASES = ['generating', 'validating', 'fixing', 'polishing', 'verifying'] as const;
const PHASE_KEYS: Record<(typeof PHASES)[number], string> = {
  generating: 'create.build.phase.generate',
  validating: 'create.build.phase.validate',
  fixing: 'create.build.phase.fix',
  polishing: 'create.build.phase.polish',
  verifying: 'create.build.phase.verify',
};

/** Same rule as Android: match the phase name, else estimate from the overall percentage. */
function phaseIndex(phase: string, percent: number): number {
  const p = (phase || '').toLowerCase();
  const idx = PHASES.findIndex((name) => p.includes(name.slice(0, 5)));
  if (idx >= 0) return idx;
  return Math.min(PHASES.length - 1, Math.max(0, Math.floor((percent / 100) * PHASES.length)));
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface GenerationProgressProps {
  /** Where the build is: running, finished, or stopped with an error. */
  stage?: 'building' | 'ready' | 'failed';
  startedAt?: number | null;
  finishedAt?: number | null;
  /** Recent distinct status messages from the build stream, oldest first. */
  log?: string[];
}

/** The build's real steps, driven by the generation stream's status events (phase, message, detail, percent). */
export function GenerationProgress({ stage = 'building', startedAt = null, finishedAt = null, log = [] }: GenerationProgressProps) {
  const t = useTranslations();
  const { phase, detail, message, progressPercent } = useGenerationStore();
  const building = stage === 'building';
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!building) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [building]);

  const current = phaseIndex(phase, progressPercent);
  const elapsed = startedAt ? ((finishedAt ?? now) - startedAt) / 1000 : 0;
  const title =
    stage === 'ready' ? t('create.build.complete') : stage === 'failed' ? t('create.build.failed') : t('create.build.building');
  const recent = log.slice(-4);
  const pct = Math.min(100, Math.max(0, Math.round(progressPercent || 0)));

  // Once the app is built the steps are noise: keep one line with the time it took.
  if (stage === 'ready') {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-success/15 text-success" aria-hidden>
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
          {title}
        </p>
        {startedAt && <span className="text-sm tabular-nums text-muted">{formatElapsed(elapsed)}</span>}
      </div>
    );
  }

  return (
    <div aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-foreground">{title}</p>
        {startedAt && <span className="text-sm tabular-nums text-muted">{formatElapsed(elapsed)}</span>}
      </div>

      <ol className="mt-3 space-y-0">
        {PHASES.map((p, i) => {
          const done = i < current;
          const active = building && i === current;
          const stopped = stage === 'failed' && i === current;
          return (
            <li key={p} className="relative flex items-center gap-3 py-1.5">
              {i < PHASES.length - 1 && (
                <span
                  className={`absolute left-[9px] top-[26px] h-[calc(100%-16px)] w-px ${done ? 'bg-success/50' : 'bg-border'}`}
                  aria-hidden
                />
              )}
              {done ? (
                <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              ) : active ? (
                <span className="h-[19px] w-[19px] shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
              ) : stopped ? (
                <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger" aria-hidden>
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
              ) : (
                <span className="h-[19px] w-[19px] shrink-0 rounded-full border-2 border-border" aria-hidden />
              )}
              <span className={done || active ? (active ? 'font-medium text-foreground' : 'text-foreground') : 'text-muted'}>
                {t(PHASE_KEYS[p])}
              </span>
            </li>
          );
        })}
      </ol>

      {building && (
        <div className="mt-4">
          <p className="text-sm text-foreground">{detail || message || t('create.build.working')}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(pct, 3)}%` }} />
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <ul className="mt-3 space-y-0.5 border-l border-border pl-3">
          {recent.map((line, i) => (
            <li key={`${i}-${line}`} className="line-clamp-2 text-sm text-muted">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
