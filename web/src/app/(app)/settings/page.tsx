'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/authStore';
import { createClient } from '@/lib/supabase';
import { SUBSCRIPTION_TIERS } from '@/lib/constants';
import { api } from '@/lib/api';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  zh: '中文(简体)',
  ko: '한국어',
  pt: 'Português',
  it: 'Italiano',
  hi: 'हिन्दी',
};

export default function SettingsPage() {
  const t = useTranslations();
  const { user, subscription, refreshSubscription } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [currentLocale, setCurrentLocale] = useState('en');

  const currentTier = subscription?.tier || 'free';
  const tierInfo = SUBSCRIPTION_TIERS[currentTier as keyof typeof SUBSCRIPTION_TIERS] || SUBSCRIPTION_TIERS.free;

  // Read current locale from cookie
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/);
    if (match) setCurrentLocale(match[1]);
  }, []);

  function handleLocaleChange(newLocale: string) {
    document.cookie = `locale=${newLocale};path=/;max-age=${365 * 24 * 60 * 60}`;
    localStorage.setItem('locale', newLocale);
    setCurrentLocale(newLocale);
    router.refresh();
  }

  // Handle Stripe checkout return
  useEffect(() => {
    const checkout = searchParams.get('checkout');
    if (checkout === 'success') {
      setCheckoutSuccess(true);
      if (user?.id) {
        refreshSubscription(user.id);
      }
      window.history.replaceState({}, '', '/settings');
    } else if (checkout === 'cancelled') {
      window.history.replaceState({}, '', '/settings');
    }
  }, [searchParams, user?.id, refreshSubscription]);

  async function handleStripeCheckout() {
    if (!user) return;
    setIsCheckoutLoading(true);
    try {
      const data = await api.post<{ url: string }>('/api/subscriptions/create-checkout', {
        userId: user.id,
        email: user.email,
        tier: 'pro',
      });
      window.location.href = data.url;
    } catch (err) {
      console.error('Checkout failed:', err);
      setIsCheckoutLoading(false);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  const upgradeFeatures = [
    t('settings.unlimitedGenerations'),
    t('settings.unlimitedTweaks'),
    t('settings.privateProjects'),
    t('settings.customDomains'),
    t('settings.priorityQueue'),
  ];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-8">{t('settings.title')}</h1>

      {/* Checkout success banner */}
      {checkoutSuccess && (
        <div className="mb-6 px-4 py-3 bg-success/10 border border-success/20 rounded-xl text-sm text-success font-medium flex items-center gap-2">
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {t('settings.welcomePro')}
        </div>
      )}

      {/* Profile */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">{t('settings.profile')}</h2>
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center text-lg font-bold text-accent">
              {user?.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="font-medium">
                {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
              </p>
              <p className="text-sm text-muted">{user?.email}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Language */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">{t('settings.language')}</h2>
        <div className="bg-card border border-border rounded-xl p-4">
          <select
            value={currentLocale}
            onChange={(e) => handleLocaleChange(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-accent transition"
          >
            {SUPPORTED_LOCALES.map((loc) => (
              <option key={loc} value={loc}>
                {LANGUAGE_NAMES[loc] || loc}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Subscription */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">{t('settings.subscription')}</h2>
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{tierInfo.name} Plan</p>
                {currentTier !== 'free' && (
                  <span className="px-2 py-0.5 bg-accent/20 text-accent text-xs rounded-full font-medium">
                    {t('common.active')}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted mt-1">
                {tierInfo.dailyGenerations === Infinity ? t('common.unlimited') : tierInfo.dailyGenerations} {t('settings.generationsPerDay')},{' '}
                {tierInfo.tweaksPerProject === Infinity ? t('common.unlimited') : tierInfo.tweaksPerProject} {t('settings.tweaksPerProject')}
              </p>
            </div>
            {currentTier === 'free' && (
              <button
                onClick={() => setShowUpgrade(true)}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition"
              >
                {t('settings.upgradeTitle')}
              </button>
            )}
          </div>

          {/* Usage stats */}
          {subscription?.limits && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs text-muted mb-2">{t('settings.currentUsage')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface rounded-lg p-3">
                  <p className="text-xs text-muted">{t('settings.dailyGenerations')}</p>
                  <p className="text-sm font-semibold">
                    {typeof subscription.limits.dailyGenerations === 'number'
                      ? `${subscription.limits.dailyGenerations} ${t('settings.perDay')}`
                      : subscription.limits.dailyGenerations}
                  </p>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <p className="text-xs text-muted">{t('settings.tweaksPerProjectLabel')}</p>
                  <p className="text-sm font-semibold">
                    {typeof subscription.limits.tweaksPerProject === 'number'
                      ? `${subscription.limits.tweaksPerProject} ${t('settings.perProject')}`
                      : subscription.limits.tweaksPerProject}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Features list for current plan */}
          <div className="pt-3 border-t border-border">
            <p className="text-xs text-muted mb-2">{t('settings.yourPlanIncludes')}</p>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2 text-sm text-muted">
                <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {tierInfo.dailyGenerations === Infinity ? t('common.unlimited') : tierInfo.dailyGenerations} {t('settings.generationsPerDay')}
              </li>
              <li className="flex items-center gap-2 text-sm text-muted">
                <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {tierInfo.tweaksPerProject === Infinity ? t('common.unlimited') : tierInfo.tweaksPerProject} {t('settings.tweaksPerProject')}
              </li>
              <li className="flex items-center gap-2 text-sm text-muted">
                <svg className={`w-4 h-4 shrink-0 ${tierInfo.canCreatePrivateProjects ? 'text-success' : 'text-subtle'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tierInfo.canCreatePrivateProjects ? "M5 13l4 4L19 7" : "M6 18L18 6M6 6l12 12"} />
                </svg>
                {tierInfo.canCreatePrivateProjects ? t('settings.privateProjects') : t('settings.publicOnly')}
              </li>
              {currentTier !== 'free' && (
                <>
                  <li className="flex items-center gap-2 text-sm text-muted">
                    <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t('settings.customDomains')}
                  </li>
                  <li className="flex items-center gap-2 text-sm text-muted">
                    <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t('settings.priorityQueue')}
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* Upgrade Dialog */}
      {showUpgrade && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowUpgrade(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-2">{t('settings.upgradeTitle')}</h3>
            <p className="text-sm text-muted mb-6">{t('settings.upgradeDescription')}</p>

            <div className="bg-surface border border-border rounded-xl p-4 mb-6">
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-bold">{t('settings.priceMonthly')}</span>
                <span className="text-sm text-muted">{t('settings.perMonth')}</span>
              </div>
              <ul className="space-y-2">
                {upgradeFeatures.map((feat) => (
                  <li key={feat} className="flex items-center gap-2 text-sm text-muted">
                    <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowUpgrade(false)}
                className="flex-1 px-4 py-2.5 border border-border hover:bg-surface rounded-xl text-sm font-medium transition"
              >
                {t('common.maybeLater')}
              </button>
              <button
                onClick={handleStripeCheckout}
                disabled={isCheckoutLoading}
                className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
              >
                {isCheckoutLoading ? t('settings.redirecting') : t('settings.subscribe')}
              </button>
            </div>

            <p className="text-xs text-subtle mt-3 text-center">
              {t('settings.stripeNote')}
            </p>
          </div>
        </div>
      )}

      {/* Sign Out */}
      <section>
        <button
          onClick={handleSignOut}
          className="px-4 py-2 bg-danger/10 hover:bg-danger/20 text-danger text-sm font-medium rounded-xl transition"
        >
          {t('common.signOut')}
        </button>
      </section>
    </div>
  );
}
