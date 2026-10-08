'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import { AppsIcon, CreateIcon, ExploreIcon, AccountIcon, SignOutIcon } from './NavIcons';

/** The same four places as the Android app's bottom tabs, in the same order. */
export function useNavItems() {
  const t = useTranslations('nav');
  return [
    { href: '/dashboard', label: t('apps'), Icon: AppsIcon },
    { href: '/project/new', label: t('create'), Icon: CreateIcon },
    { href: '/community', label: t('explore'), Icon: ExploreIcon },
    { href: '/settings', label: t('account'), Icon: AccountIcon },
  ];
}

export function useIsActive() {
  const pathname = usePathname();
  return (href: string) => {
    if (!pathname) return false;
    if (href === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/project/') && !pathname.startsWith('/project/new');
    return pathname === href || pathname.startsWith(href + '/');
  };
}

/** Desktop: a left rail with labels. Phones use [BottomTabs]. */
export function Sidebar() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { sidebarOpen } = useUIStore();
  const t = useTranslations();
  const items = useNavItems();
  const isActive = useIsActive();

  if (!sidebarOpen) return null;

  async function handleSignOut() {
    await createClient().auth.signOut();
    router.push('/');
  }

  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <Link href="/project/new" className="flex items-center gap-2.5 px-5 pb-6 pt-6">
        <img src="/favicon-32x32.png" alt="" className="h-7 w-7 rounded-lg" />
        <span className="font-display text-[19px] font-semibold">{t('common.vibebuild')}</span>
      </Link>

      <nav className="flex-1 space-y-0.5 px-3" aria-label={t('nav.label')}>
        {items.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors',
                active ? 'bg-accent/15 font-semibold text-accent-hover' : 'text-muted hover:bg-surface hover:text-foreground'
              )}
            >
              <Icon />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-3 border-t border-border p-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-sm font-semibold text-accent-hover">
          {user?.email?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user?.user_metadata?.full_name || user?.email?.split('@')[0] || ''}</p>
          <p className="truncate text-xs text-subtle">{user?.email}</p>
        </div>
        <button onClick={handleSignOut} className="rounded-md p-1.5 text-subtle transition hover:bg-surface hover:text-foreground" title={t('common.signOut')} aria-label={t('common.signOut')}>
          <SignOutIcon />
        </button>
      </div>
    </aside>
  );
}

/** Phones: the four tabs along the bottom, as on Android. */
export function BottomTabs() {
  const items = useNavItems();
  const isActive = useIsActive();
  const t = useTranslations('nav');
  return (
    <nav
      aria-label={t('label')}
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card/95 backdrop-blur md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map(({ href, label, Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn('flex flex-1 flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-medium transition-colors', active ? 'text-accent-hover' : 'text-subtle')}
          >
            <Icon />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
