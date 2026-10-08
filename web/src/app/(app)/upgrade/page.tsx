'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/authStore';
import { SUBSCRIPTION_TIERS } from '@/lib/constants';
import { PlanCompare } from '@/components/upgrade/PlanCompare';
import { Spinner } from '@/components/upgrade/Spinner';
import { ManageBillingButton } from '@/components/upgrade/ManageBillingButton';
import { useCheckout } from '@/components/upgrade/useCheckout';

/**
 * The web's paywall, after Android's LocalPaywall: a close control, what Pro adds over Free, one plan (Pro, monthly), and a
 * Continue button pinned at the bottom so it never needs a scroll. Subscribers see their plan instead.
 */
export default function UpgradePage() {
  const t = useTranslations('account.upgrade');
  const router = useRouter();
  const subscription = useAuthStore((s) => s.subscription);
  const { state, start } = useCheckout();

  const leave = () => router.push('/project/new');
  const tier = subscription?.tier ?? 'free';
  const subscribed = !!subscription && tier !== 'free';
  const planName = SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS]?.name ?? SUBSCRIPTION_TIERS.pro.name;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="mx-auto flex h-14 w-full max-w-[640px] shrink-0 items-center justify-end px-2">
        <button
          onClick={leave}
          aria-label={t('close')}
          title={t('close')}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {!subscription ? (
        <Spinner label={t('loading')} />
      ) : subscribed ? (
        <>
          <main className="flex min-h-0 flex-1 overflow-y-auto">
            <div className="m-auto w-full max-w-[640px] px-4 py-6">
              <h1 className="font-display text-[32px] font-bold leading-[1.1] md:text-[44px]">{t('subscribedTitle', { plan: planName })}</h1>
              <p className="mt-3 max-w-[56ch] text-[15px] text-muted">{t('subscribedBody')}</p>
            </div>
          </main>
          <footer className="shrink-0 border-t border-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="mx-auto flex w-full max-w-[640px] gap-3 px-4 py-4">
              <ManageBillingButton wrapperClassName="min-w-0 flex-1 items-stretch" className="flex h-12 w-full items-center justify-center rounded-lg border border-border text-[15px] font-medium transition-colors hover:bg-surface" label={t('manage')} />
              <Link
                href="/project/new"
                className="flex h-12 flex-1 items-center justify-center rounded-lg bg-accent text-[15px] font-semibold text-white transition-colors hover:bg-accent-deep"
              >
                {t('startBuilding')}
              </Link>
            </div>
          </footer>
        </>
      ) : (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[640px] px-4 pb-8 pt-2 md:pt-8">
              <h1 className="font-display text-[32px] font-bold leading-[1.1] md:text-[44px]">{t('title')}</h1>
              <p className="mt-3 max-w-[56ch] text-[15px] text-muted">{t('subtitle')}</p>
              <div className="mt-6 md:mt-10">
                <PlanCompare />
              </div>
              <p className="mt-6 max-w-[60ch] text-[15px] text-muted">{t('both')}</p>
            </div>
          </main>

          <footer className="shrink-0 border-t border-border bg-background" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="mx-auto w-full max-w-[640px] px-4 pb-3 pt-4">
              {state === 'failed' && (
                <p role="alert" className="mb-3 text-[15px] text-danger">
                  {t('checkoutError')}
                </p>
              )}
              <button
                onClick={start}
                disabled={state === 'starting'}
                className="h-12 w-full rounded-lg bg-accent text-[16px] font-semibold text-white transition-colors hover:bg-accent-deep disabled:opacity-60"
              >
                {state === 'starting' ? t('redirecting') : state === 'failed' ? t('retry') : t('continue')}
              </button>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-muted">
                <span>{t('renewal')}</span>
                <span className="flex gap-1">
                  <Link href="/terms" className="rounded px-1.5 py-2 hover:text-foreground">{t('terms')}</Link>
                  <Link href="/privacy" className="rounded px-1.5 py-2 hover:text-foreground">{t('privacy')}</Link>
                </span>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
