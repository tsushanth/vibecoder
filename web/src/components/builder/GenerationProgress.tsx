'use client';

import { useTranslations } from 'next-intl';
import { useGenerationStore } from '@/stores/generationStore';
import { api } from '@/lib/api';
import { useState } from 'react';

const PHASE_ORDER = ['generating', 'validating', 'fixing', 'polishing', 'verifying'];

export function GenerationProgress() {
  const t = useTranslations();
  const { phase, message, detail, estimatedSecondsRemaining, systemBusy, error } =
    useGenerationStore();
  const [upgrading, setUpgrading] = useState(false);

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      const data = await api.post<{ url: string }>('/api/subscriptions/create-checkout', {});
      if (data.url) window.location.href = data.url;
    } catch {
      setUpgrading(false);
    }
  };

  if (systemBusy && error) {
    return (
      <div className="animate-fade-in rounded-2xl border border-border bg-card px-6 py-10 text-center">
        <div className="mb-4 text-4xl">🔥</div>
        <h2 className="mb-2 text-lg font-semibold">High demand right now</h2>
        <p className="mx-auto mb-6 max-w-sm text-sm text-muted">
          Our builders are at full capacity. Pro users get priority access and skip the queue.
        </p>
        <button
          onClick={handleUpgrade}
          disabled={upgrading}
          className="mb-3 rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {upgrading ? 'Redirecting...' : '⚡ Upgrade to Pro — Build Instantly'}
        </button>
        <button
          onClick={() => window.location.reload()}
          className="block w-full text-xs text-muted transition-colors hover:text-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  const PHASE_LABELS: Record<string, string> = {
    generating: t('generation.phases.generating'),
    validating: t('generation.phases.validating'),
    fixing: t('generation.phases.fixing'),
    polishing: t('generation.phases.polishing'),
    verifying: t('generation.phases.verifying'),
  };

  const currentIndex = PHASE_ORDER.indexOf(phase);

  return (
    <div className="animate-fade-in rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold">{t('generation.buildingYourApp')}</p>
        {estimatedSecondsRemaining != null && estimatedSecondsRemaining > 0 && (
          <span className="font-mono text-xs text-subtle">
            {t('generation.secondsRemaining', { seconds: Math.ceil(estimatedSecondsRemaining) })}
          </span>
        )}
      </div>

      <ul className="space-y-2.5">
        {PHASE_ORDER.map((p, i) => {
          const done = currentIndex >= 0 && i < currentIndex;
          const active = i === currentIndex || (currentIndex === -1 && i === 0);
          return (
            <li key={p} className="flex items-center gap-2.5 text-sm">
              {done ? (
                <svg className="h-4 w-4 shrink-0 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : active ? (
                <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              ) : (
                <div className="h-4 w-4 shrink-0 rounded-full border-2 border-border" />
              )}
              <span className={done ? 'text-foreground' : active ? 'font-medium text-foreground' : 'text-subtle'}>
                {PHASE_LABELS[p]}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-sm text-foreground">{message || t('generation.connectingServer')}</p>
        {detail && <p className="mt-0.5 text-xs text-muted">{detail}</p>}
      </div>
    </div>
  );
}
