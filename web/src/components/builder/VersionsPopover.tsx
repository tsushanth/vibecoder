'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ProjectVersion } from '@/types/api';

interface VersionsPopoverProps {
  versions: ProjectVersion[];
  activeVersionSha: string | null;
  isReverting: boolean;
  disabled?: boolean;
  onLoad: (sha: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function shortDescription(message: string, fallback: string): string {
  return message.replace(/^Tweak:\s*/i, '').trim() || fallback;
}

export function VersionsPopover({
  versions,
  activeVersionSha,
  isReverting,
  disabled,
  onLoad,
}: VersionsPopoverProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Esc so the dropdown behaves like a menu.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Newest first. Backend already returns descending but be defensive in
  // case the store gets re-seeded with a different order.
  const sorted = [...(Array.isArray(versions) ? versions : [])].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const total = sorted.length;
  const label = t('common.versions');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted transition hover:bg-surface hover:text-foreground"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="hidden sm:inline">{label}</span>
        {total > 0 && <span className="tabular-nums text-subtle">{total}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 max-h-[60vh] w-[min(20rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-border bg-card shadow-2xl shadow-background/60">
          <div className="sticky top-0 border-b border-border bg-card px-4 py-3">
            <div className="font-medium text-foreground">{label}</div>
            <div className="text-sm text-muted">
              {total === 0 ? t('versions.empty') : t('versions.count', { count: total })}
            </div>
          </div>

          {total === 0 ? (
            <div className="px-4 py-6 text-sm text-muted">{t('versions.emptyHint')}</div>
          ) : (
            <ul className="divide-y divide-border">
              {sorted.map((v, idx) => {
                const versionNumber = total - idx; // 1-based, oldest = 1
                const isActive = v.sha === activeVersionSha;
                return (
                  <li key={v.sha} className={cn('flex items-center gap-3 px-4 py-2.5', isActive && 'bg-accent/10')}>
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                        isActive ? 'bg-accent text-white' : 'bg-surface text-muted'
                      )}
                    >
                      {versionNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{shortDescription(v.message, t('create.versions.untitled'))}</p>
                      <p className="text-xs text-muted">{formatDate(v.date)}</p>
                    </div>
                    {isActive ? (
                      <span className="shrink-0 text-sm font-medium text-accent-hover">{t('common.current')}</span>
                    ) : !disabled ? (
                      <button
                        type="button"
                        onClick={() => {
                          onLoad(v.sha);
                          setOpen(false);
                        }}
                        disabled={isReverting}
                        className="min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-accent-hover transition hover:bg-surface disabled:opacity-50"
                      >
                        {t('common.load')}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
