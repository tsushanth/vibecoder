'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/authStore';
import { createClient } from '@/lib/supabase';
import { SUBSCRIPTION_TIERS } from '@/lib/constants';
import { api, ApiError } from '@/lib/api';
import { SUPPORTED_LOCALES } from '@/i18n/locales';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/upgrade/Spinner';
import { ManageBillingButton } from '@/components/upgrade/ManageBillingButton';

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

/** A limit from the server (a number, a word, or null for Infinity once it has been through JSON) or the local tier table. */
function limitText(server: number | string | null | undefined, local: number, unlimited: string): string {
  if (typeof server === 'number' && Number.isFinite(server)) return String(server);
  if (server == null || typeof server === 'number') return Number.isFinite(local) ? String(local) : unlimited;
  return /unlimited/i.test(server) ? unlimited : server;
}

function Chevron() {
  return (
    <svg className="h-4 w-4 shrink-0 text-subtle" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
    </svg>
  );
}

const rowClass = 'flex min-h-[52px] w-full items-center gap-3 px-1 text-left text-[15px] transition-colors hover:bg-surface/60';

function ConfirmDialog({
  title,
  body,
  confirm,
  cancel,
  busy,
  error,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
  busy?: boolean;
  error?: string | null;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-4 sm:items-center" onClick={() => !busy && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="font-display text-[20px] font-bold">{title}</h2>
        <p className="mt-2 text-[15px] text-muted">{body}</p>
        {error && <p role="alert" className="mt-3 text-[15px] text-danger">{error}</p>}
        <div className="mt-5 flex gap-3">
          <button
            autoFocus
            onClick={onCancel}
            disabled={busy}
            className="h-11 flex-1 rounded-lg border border-border text-[15px] font-medium transition-colors hover:bg-surface disabled:opacity-60"
          >
            {cancel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'h-11 flex-1 rounded-lg text-[15px] font-semibold transition-colors disabled:opacity-60',
              danger ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'bg-accent text-white hover:bg-accent-deep'
            )}
          >
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountScreen() {
  const t = useTranslations('account.page');
  const tc = useTranslations('common');
  const { user, subscription, refreshSubscription } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [currentLocale, setCurrentLocale] = useState('en');
  const [appCount, setAppCount] = useState<number | null>(null);
  const [dialog, setDialog] = useState<null | 'signOut' | 'delete'>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const currentTier = subscription?.tier || 'free';
  const tierInfo = SUBSCRIPTION_TIERS[currentTier as keyof typeof SUBSCRIPTION_TIERS] || SUBSCRIPTION_TIERS.free;
  const paid = currentTier !== 'free';

  // Read current locale from cookie
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/);
    if (match) setCurrentLocale(match[1]);
  }, []);

  function handleLocaleChange(newLocale: string) {
    document.cookie = `locale=${newLocale};path=/;max-age=${365 * 24 * 60 * 60}`;
    try {
      localStorage.setItem('locale', newLocale);
    } catch {
      // the cookie is what the server reads; storage is only a convenience
    }
    setCurrentLocale(newLocale);
    router.refresh();
  }

  // Handle Stripe checkout return (the server's success and cancel urls point here)
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

  // how many apps, as on Android's usage card; the stat is left out if the list cannot be read
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    api
      .get<{ projects?: unknown[]; totalCount?: number }>(`/api/projects/my?userId=${user.id}`)
      .then((d) => alive && setAppCount(typeof d.totalCount === 'number' ? d.totalCount : d.projects?.length ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user?.id]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  async function handleDelete() {
    if (!user) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete('/api/auth/account', { userId: user.id });
      await createClient().auth.signOut().catch(() => {});
      router.push('/');
    } catch (err) {
      setDeleteError(err instanceof ApiError && err.status === 401 ? t('deleteSignInAgain') : t('deleteError'));
      setDeleting(false);
    }
  }

  const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || t('defaultName');
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const unlimited = tc('unlimited');
  const stats = [
    ...(appCount !== null ? [{ label: t('statApps'), value: String(appCount) }] : []),
    { label: t('statGenerations'), value: limitText(subscription?.limits?.dailyGenerations, tierInfo.dailyGenerations, unlimited) },
    { label: t('statTweaks'), value: limitText(subscription?.limits?.tweaksPerProject, tierInfo.tweaksPerProject, unlimited) },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 md:py-14">
      <h1 className="sr-only">{t('title')}</h1>

      {checkoutSuccess && (
        <div role="status" className="mb-6 flex items-center gap-2 rounded-xl border border-success/25 bg-success/10 px-4 py-3 text-[15px] font-medium text-success">
          <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {t('welcomePro')}
        </div>
      )}

      {/* Profile */}
      <section className="flex items-center gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent/20 font-display text-[26px] font-bold text-accent-hover" aria-hidden>
            {(name[0] || '?').toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-display text-[26px] font-bold leading-tight">{name}</p>
          <p className="truncate text-[15px] text-muted">{user?.email}</p>
        </div>
      </section>

      {/* Plan and usage: the one panel on the page */}
      <section className="mt-8 rounded-xl border border-border bg-card" aria-labelledby="plan-heading">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 id="plan-heading" className="font-display text-[20px] font-bold">
                {t('planNamed', { plan: tierInfo.name })}
              </h2>
              {paid && <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-[13px] font-semibold text-accent-hover">{t('active')}</span>}
            </div>
            <p className="mt-0.5 text-[15px] text-muted">{paid ? t('planPaidDetail') : t('planFreeDetail')}</p>
          </div>
          {!paid && (
            <Link
              href="/upgrade"
              className="flex h-10 items-center rounded-lg bg-accent px-4 text-[15px] font-semibold text-white transition-colors hover:bg-accent-deep"
            >
              {t('upgrade')}
            </Link>
          )}
          {paid && (
            <ManageBillingButton
              className="flex h-10 items-center rounded-lg border border-border px-4 text-[15px] font-medium transition-colors hover:bg-surface"
              label={t('manage')}
            />
          )}
        </div>
        <dl className="grid border-t border-border" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
          {stats.map((s, i) => (
            <div key={s.label} className={cn('flex flex-col justify-between px-4 py-4 sm:px-5', i > 0 && 'border-l border-border')}>
              <dt className="text-[13px] leading-snug text-muted">{s.label}</dt>
              <dd className={cn('mt-1 font-display font-bold tabular-nums', /^\d+$/.test(s.value) ? 'text-[22px]' : 'break-words text-[17px] sm:text-[22px]')}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Settings */}
      <section className="mt-10" aria-labelledby="settings-heading">
        <h2 id="settings-heading" className="mb-1 text-[15px] font-semibold text-muted">{t('settings')}</h2>
        <div className="divide-y divide-border border-y border-border">
          <Link href="/upgrade" className={rowClass}>
            <span className="flex-1">{t('subscription')}</span>
            <span className="text-muted">{tierInfo.name}</span>
            <Chevron />
          </Link>
          <label className={cn(rowClass, 'cursor-pointer')}>
            <span className="flex-1">{t('language')}</span>
            <select
              value={currentLocale}
              onChange={(e) => handleLocaleChange(e.target.value)}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-[15px] text-foreground focus:border-accent"
            >
              {SUPPORTED_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {LANGUAGE_NAMES[loc] || loc}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* About */}
      <section className="mt-10" aria-labelledby="about-heading">
        <h2 id="about-heading" className="mb-1 text-[15px] font-semibold text-muted">{t('about')}</h2>
        <div className="divide-y divide-border border-y border-border">
          <Link href="/terms" className={rowClass}>
            <span className="flex-1">{t('terms')}</span>
            <Chevron />
          </Link>
          <Link href="/privacy" className={rowClass}>
            <span className="flex-1">{t('privacy')}</span>
            <Chevron />
          </Link>
        </div>
      </section>

      {/* Sign out and delete */}
      <section className="mt-10 divide-y divide-border border-y border-border">
        <button onClick={() => setDialog('signOut')} className={rowClass}>
          <svg className="h-5 w-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 01-2-2V6a2 2 0 012-2h6" />
          </svg>
          <span className="flex-1">{t('signOut')}</span>
        </button>
        <button
          onClick={() => {
            setDeleteError(null);
            setDialog('delete');
          }}
          className={cn(rowClass, 'text-danger')}
        >
          <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
          </svg>
          <span className="flex-1">{t('deleteAccount')}</span>
        </button>
      </section>

      {dialog === 'signOut' && (
        <ConfirmDialog
          title={t('signOutTitle')}
          body={t('signOutBody')}
          confirm={t('signOut')}
          cancel={t('cancel')}
          onConfirm={handleSignOut}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          danger
          title={t('deleteTitle')}
          body={t('deleteBody')}
          confirm={deleting ? t('deleting') : t('deleteConfirm')}
          cancel={t('cancel')}
          busy={deleting}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

export default function SettingsPage() {
  const t = useTranslations('account.page');
  return (
    <Suspense fallback={<div className="flex h-full"><Spinner label={t('title')} /></div>}>
      <AccountScreen />
    </Suspense>
  );
}
