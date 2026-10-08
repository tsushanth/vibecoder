'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/authStore';
import { api, ApiError } from '@/lib/api';
import { ExploreList } from '@/components/project/ProjectCard';
import type { ForkResponse } from '@/types/api';

export default function ExplorePage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const t = useTranslations('apps.explore');
  const [remixError, setRemixError] = useState<string | null>(null);
  const [remixing, setRemixing] = useState(false);

  async function handleRemix(projectId: string) {
    if (!user) return router.push('/login');
    if (remixing) return;
    setRemixing(true);
    setRemixError(null);
    try {
      const data = await api.post<ForkResponse>(`/api/projects/${projectId}/fork`, {
        userId: user.id,
        userName: user.user_metadata?.full_name || user.email?.split('@')[0],
      });
      router.push(`/project/${data.projectId}`);
    } catch (err) {
      setRemixError(err instanceof ApiError ? err.message : t('remixFailed'));
      setRemixing(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="pb-5">
        <h1 className="font-display text-3xl font-bold">{t('title')}</h1>
        <p className="mt-1 max-w-[60ch] text-muted">{t('subtitle')}</p>
      </header>
      {remixing && <p role="status" className="mb-3 text-sm text-accent-hover">{t('remixing')}</p>}
      {remixError && <p role="alert" className="mb-3 text-sm text-danger">{remixError}</p>}
      <ExploreList
        defaultSort="newest"
        userId={user?.id ?? null}
        onRemix={(id) => void handleRemix(id)}
        onOpenUnpublished={(id) => router.push(`/project/${id}`)}
      />
    </div>
  );
}
