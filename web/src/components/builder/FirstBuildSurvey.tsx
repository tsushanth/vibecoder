'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { SURVEY_CHOICES, markSurveyHandled, surveyHandled, type SurveyAnswer } from '@/lib/firstBuildSurvey';

/**
 * One optional question, shown once, after a person's first ready build: "What were you hoping to make today?".
 * Fixed choices only, so nothing typed is ever stored. The server says whether this person is eligible (their first ready
 * build, never answered or dismissed) and keeps the answer; this component also remembers locally that it was handled, so a
 * dismissed prompt never comes back. Failures are silent: the survey must never get in the way of the build result.
 */
export function FirstBuildSurvey({ projectId }: { projectId: string | null }) {
  const t = useTranslations('create.survey');
  const [state, setState] = useState<'hidden' | 'asking' | 'thanks'>('hidden');

  useEffect(() => {
    if (!projectId || surveyHandled()) return;
    let cancelled = false;
    api
      .get<{ eligible?: boolean }>(`/api/events/first-build-survey?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => {
        if (!cancelled && r.eligible === true) setState('asking');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function answer(choice: SurveyAnswer) {
    markSurveyHandled();
    setState(choice === 'dismissed' ? 'hidden' : 'thanks');
    try {
      await api.post('/api/events/first-build-survey', { choice });
    } catch {
      /* asked once either way; losing one answer is better than asking twice */
    }
  }

  if (state === 'hidden') return null;
  if (state === 'thanks') {
    return <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{t('thanks')}</p>;
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5" role="group" aria-labelledby="first-build-survey-q">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id="first-build-survey-q" className="font-display text-base font-semibold text-foreground">{t('question')}</p>
          <p className="mt-0.5 text-xs text-muted">{t('hint')}</p>
        </div>
        <button type="button" onClick={() => answer('dismissed')} className="shrink-0 rounded-md px-2 py-1 text-xs text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          {t('skip')}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {SURVEY_CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => answer(c)}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground transition hover:border-accent-hover hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t(c)}
          </button>
        ))}
      </div>
    </div>
  );
}
