'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/authStore';
import { api, ApiError } from '@/lib/api';
import { ProjectRow, appStatus, type OwnedProject } from '@/components/project/ProjectCard';
import type { MyProjectsResponse } from '@/types/api';

const REFRESH_WHILE_BUILDING_MS = 15_000; // as on Android: look again while any app is still building

export default function DashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const t = useTranslations('apps');
  const [projects, setProjects] = useState<OwnedProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<OwnedProject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadProjects = useCallback(async (quiet = false) => {
    if (!user) return;
    if (!quiet) setIsLoading(true);
    try {
      const data = await api.get<MyProjectsResponse>(`/api/projects/my?userId=${user.id}`);
      const list = [...(data.projects as OwnedProject[])].sort(
        (a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
      );
      setProjects(list);
      setLoadError(false);
    } catch (err) {
      console.error('Failed to load projects:', err);
      if (!quiet) setLoadError(true);
    } finally {
      if (!quiet) setIsLoading(false);
    }
  }, [user]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const hasBuilding = projects.some((p) => appStatus(p) === 'building');
  useEffect(() => {
    if (!hasBuilding) return;
    const id = setInterval(() => void loadProjects(true), REFRESH_WHILE_BUILDING_MS);
    return () => clearInterval(id);
  }, [hasBuilding, loadProjects]);

  async function confirmDelete() {
    if (!user || !pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/projects/${pendingDelete.id}`, { userId: user.id });
      const gone = pendingDelete.id;
      setProjects((prev) => prev.filter((p) => p.id !== gone));
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t('deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="font-display text-3xl font-bold">{t('title')}</h1>
          {!isLoading && projects.length > 0 && (
            <p className="mt-1 text-muted">{t('count', { count: projects.length })}</p>
          )}
        </div>
        {projects.length > 0 && (
          <Link
            href="/project/new"
            className="flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[15px] font-semibold text-white transition hover:bg-accent-hover"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M12 5v14M5 12h14" />
            </svg>
            {t('create')}
          </Link>
        )}
      </header>

      {isLoading ? (
        <div className="flex justify-center py-24">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : loadError ? (
        <div className="py-20 text-center">
          <p className="text-muted">{t('loadFailed')}</p>
          <button onClick={() => void loadProjects()} className="mt-4 h-10 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface">
            {t('retry')}
          </button>
        </div>
      ) : projects.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-1 gap-x-10 xl:grid-cols-2">
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              onOpen={() => router.push(`/project/${p.id}`)}
              onDelete={() => { setDeleteError(null); setPendingDelete(p); }}
            />
          ))}
        </ul>
      )}

      {pendingDelete && (
        <ConfirmDelete
          title={pendingDelete.title}
          busy={isDeleting}
          error={deleteError}
          onCancel={() => { if (!isDeleting) setPendingDelete(null); }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

function EmptyState() {
  const t = useTranslations('apps');
  return (
    <div className="py-20 sm:py-28">
      <div className="max-w-md">
        <h2 className="font-display text-2xl font-semibold">{t('emptyTitle')}</h2>
        <p className="mt-2 text-muted">{t('emptyBody')}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/project/new" className="flex h-10 items-center rounded-lg bg-accent px-5 text-[15px] font-semibold text-white transition hover:bg-accent-hover">
            {t('create')}
          </Link>
          <Link href="/community" className="flex h-10 items-center rounded-lg px-3 text-[15px] text-accent-hover transition hover:bg-surface">
            {t('emptyExplore')}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ConfirmDelete({ title, busy, error, onCancel, onConfirm }: { title: string; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations('apps');
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-background/80" onClick={onCancel} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-body" className="relative w-full max-w-sm rounded-xl border border-border bg-card p-5">
        <h2 id="delete-title" className="font-display text-lg font-semibold">{t('deleteTitle', { title })}</h2>
        <p id="delete-body" className="mt-2 text-muted">{t('deleteBody')}</p>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} onClick={onCancel} disabled={busy} className="h-10 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface">
            {t('cancel')}
          </button>
          <button onClick={onConfirm} disabled={busy} className="h-10 rounded-lg bg-danger px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
            {busy ? t('deleting') : t('delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
