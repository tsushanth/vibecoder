'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const { sidebarOpen } = useUIStore();
  const t = useTranslations();

  const navItems = [
    { href: '/dashboard', label: t('common.myApps'), icon: '📱' },
    { href: '/community', label: t('common.browse'), icon: '🔍' },
    { href: '/settings', label: t('common.settings'), icon: '⚙️' },
  ];

  const isActive = (href: string) => {
    if (!pathname) return false;
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/';
    }
    return pathname === href || pathname.startsWith(href + '/');
  };

  if (!sidebarOpen) return null;

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  return (
    <aside className="hidden md:flex w-64 h-screen bg-card border-r border-border flex-col shrink-0">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <a href="/dashboard" className="flex items-center gap-2 text-lg font-bold">
          <img src="/favicon-32x32.png" alt="VibeBuild" className="w-6 h-6 rounded" />
          <span>{t('common.vibebuild')}</span>
        </a>
      </div>

      {/* New Project button */}
      <div className="p-4">
        <button
          onClick={() => router.push('/project/new')}
          className="w-full px-4 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
        >
          <span className="text-lg">+</span>
          {t('common.newProject')}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition text-sm',
              isActive(item.href)
                ? 'bg-accent/15 text-accent font-semibold'
                : 'text-muted hover:text-foreground hover:bg-surface'
            )}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-sm font-semibold text-accent">
            {user?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
            </p>
            <p className="text-xs text-subtle truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="text-subtle hover:text-foreground transition p-1"
            title={t('common.signOut')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
