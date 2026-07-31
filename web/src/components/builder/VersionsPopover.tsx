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

function shortDescription(message: string): string {
  return message.replace(/^Tweak:\s*/i, '').trim() || 'Version';
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
  const sorted = [...versions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const total = sorted.length;
  const label = t('common.versions');

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-border hover:bg-surface text-foreground rounded-lg transition"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="hidden sm:inline">{label}</span>
        {total > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 bg-surface text-subtle rounded">
            {total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 max-h-[60vh] overflow-auto bg-card border border-border rounded-xl shadow-2xl shadow-black/40 z-50">
          <div className="px-3 py-2 border-b border-border sticky top-0 bg-card">
            <div className="text-xs font-semibold text-foreground">{label}</div>
            <div className="text-[10px] text-subtle mt-0.5">
              {total === 0
                ? t('versions.empty')
                : t('versions.count', { count: total })}
            </div>
          </div>

          {total === 0 ? (
            <div className="px-3 py-6 text-xs text-subtle text-center">
              {t('versions.emptyHint')}
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {sorted.map((v, idx) => {
                const versionNumber = total - idx; // 1-based, oldest = 1
                const isActive = v.sha === activeVersionSha;
                return (
                  <div
                    key={v.sha}
                    className={cn(
                      'rounded-lg px-2.5 py-2 text-xs border transition',
                      isActive
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-border bg-surface hover:border-accent/20'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className={cn(
                            'shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold',
                            isActive ? 'bg-accent text-white' : 'bg-surface-hover text-subtle'
                          )}
                        >
                          {versionNumber}
                        </span>
                        <span className="text-foreground truncate">
                          {shortDescription(v.message)}
                        </span>
                      </div>
                      {isActive ? (
                        <span className="shrink-0 text-[10px] text-accent font-medium px-1.5 py-0.5 bg-accent/10 rounded">
                          {t('common.current')}
                        </span>
                      ) : !disabled ? (
                        <button
                          onClick={() => {
                            onLoad(v.sha);
                            setOpen(false);
                          }}
                          disabled={isReverting}
                          className="shrink-0 text-[10px] text-accent font-medium px-1.5 py-0.5 bg-accent/10 hover:bg-accent/20 rounded transition disabled:opacity-50"
                        >
                          {isReverting ? '...' : t('common.load')}
                        </button>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1 pl-7">
                      <span className="text-[10px] text-subtle">
                        {formatDate(v.date)}
                      </span>
                      <span className="text-[9px] text-subtle font-mono">
                        {v.sha.slice(0, 7)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
