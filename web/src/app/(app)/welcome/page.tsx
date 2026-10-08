'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { afterWelcome, hasOnboarded, markOnboarded } from '@/components/welcome/onboarding';
import { Spinner } from '@/components/upgrade/Spinner';

const STEPS = [1, 2, 3, 4] as const;

/**
 * Android's four onboarding pages as one screen: the steps are a real sequence, so they are numbered and all visible at once,
 * and Next walks through them. Finishing or skipping is remembered, then subscribers go to Create and everyone else to Upgrade.
 */
export default function WelcomePage() {
  const t = useTranslations('account.welcome');
  const tc = useTranslations('common');
  const router = useRouter();
  const subscription = useAuthStore((s) => s.subscription);
  const [step, setStep] = useState(0);
  // 'checking' until browser storage has been read, so a returning visitor never sees the steps flash
  const [phase, setPhase] = useState<'checking' | 'showing' | 'leaving'>('checking');

  useEffect(() => {
    setPhase(hasOnboarded() ? 'leaving' : 'showing');
  }, []);

  // the hand-off needs the plan; the auth provider always settles it (free when the lookup fails)
  useEffect(() => {
    if (phase === 'leaving' && subscription) router.replace(afterWelcome(subscription.tier));
  }, [phase, subscription, router]);

  function finish() {
    markOnboarded();
    setPhase('leaving');
  }

  const last = step === STEPS.length - 1;

  if (phase !== 'showing') {
    return (
      <div className="fixed inset-0 z-50 flex bg-background">
        <Spinner label={t('loading')} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="mx-auto flex h-14 w-full max-w-[600px] shrink-0 items-center justify-between px-4">
        <span className="flex items-center gap-2.5">
          <img src="/favicon-32x32.png" alt="" className="h-7 w-7 rounded-lg" />
          <span className="font-display text-[19px] font-semibold">{tc('vibebuild')}</span>
        </span>
        <button onClick={finish} className="min-h-10 rounded-lg px-3 text-[15px] text-muted transition-colors hover:bg-surface hover:text-foreground">
          {t('skip')}
        </button>
      </header>

      <main className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="m-auto w-full max-w-[600px] px-4 py-4">
          <h1 className="font-display text-[30px] font-bold leading-[1.1] md:text-[44px]">{t('title')}</h1>

          <ol className="mt-6 md:mt-10">
            {STEPS.map((n, i) => {
              const state = i < step ? 'done' : i === step ? 'current' : 'next';
              return (
                <li key={n} aria-current={state === 'current' ? 'step' : undefined}>
                  <button onClick={() => setStep(i)} className="flex w-full gap-4 rounded-lg text-left md:gap-6">
                    <span className="flex w-10 shrink-0 flex-col items-center md:w-12" aria-hidden>
                      <span
                        className={cn(
                          'font-display text-[32px] font-bold leading-none transition-colors md:text-[40px]',
                          state === 'current' ? 'text-accent-hover' : state === 'done' ? 'text-foreground' : 'text-subtle'
                        )}
                      >
                        {n}
                      </span>
                      {i < STEPS.length - 1 && (
                        <span className={cn('mt-2 w-px flex-1 transition-colors', i < step ? 'bg-accent' : 'bg-border')} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 pb-5 md:pb-7">
                      <span className={cn('block pt-1 text-[17px] font-semibold md:text-[19px]', state === 'next' ? 'text-muted' : 'text-foreground')}>
                        {t(`step${n}Title`)}
                      </span>
                      <span className="mt-1 block max-w-[52ch] text-[15px] leading-snug text-muted">{t(`step${n}Body`)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex w-full max-w-[600px] items-center gap-4 px-4 py-4">
          <p className="hidden text-[15px] text-muted sm:block" aria-live="polite">
            {t('stepOf', { current: step + 1, total: STEPS.length })}
          </p>
          <button
            onClick={() => (last ? finish() : setStep(step + 1))}
            className="h-12 flex-1 rounded-lg bg-accent text-[16px] font-semibold text-white transition-colors hover:bg-accent-deep sm:ml-auto sm:max-w-[240px]"
          >
            {last ? t('getStarted') : t('next')}
          </button>
        </div>
      </footer>
    </div>
  );
}
