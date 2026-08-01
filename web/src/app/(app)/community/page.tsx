'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/authStore';
import { api, ApiError } from '@/lib/api';
import { ProjectCard } from '@/components/project/ProjectCard';
import type { ProjectSummary, BrowseResponse, ForkResponse } from '@/types/api';
import { cn } from '@/lib/utils';

function trackView(projectId: string) {
  api.post(`/api/projects/${projectId}/view`, {}).catch(() => {});
}

export default function BrowsePage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const t = useTranslations();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [featuredProjects, setFeaturedProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sort, setSort] = useState<'newest' | 'popular'>('newest');
  const [search, setSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    loadProjects(true);
    loadFeatured();
  }, [sort]);

  async function loadFeatured() {
    try {
      const data = await api.get<BrowseResponse>(
        '/api/projects/browse?limit=6&offset=0&sort=popular'
      );
      setFeaturedProjects(data.projects.filter(p => p.published_url));
    } catch {
      // Featured is best-effort
    }
  }

  async function loadProjects(reset = false, retryCount = 0) {
    setIsLoading(true);
    setLoadError(false);
    const newOffset = reset ? 0 : offset;
    try {
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : '';
      const data = await api.get<BrowseResponse>(
        `/api/projects/browse?limit=20&offset=${newOffset}&sort=${sort}${searchParam}`
      );
      setProjects(reset ? data.projects : [...projects, ...data.projects]);
      setHasMore(data.hasMore);
      setOffset(newOffset + 20);
    } catch (err) {
      console.error('Failed to load browse:', err);
      // Retry once automatically on first load (handles cold start)
      if (reset && retryCount < 1) {
        await new Promise(r => setTimeout(r, 1500));
        return loadProjects(reset, retryCount + 1);
      }
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFork(projectId: string) {
    if (!user) return router.push('/login');
    try {
      const data = await api.post<ForkResponse>(`/api/projects/${projectId}/fork`, {
        userId: user.id,
        userName: user.user_metadata?.full_name || user.email?.split('@')[0],
      });
      router.push(`/project/${data.projectId}`);
    } catch (err) {
      if (err instanceof ApiError) alert(err.message);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    loadProjects(true);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">{t('browse.title')}</h1>
        <button
          onClick={() => { loadProjects(true); loadFeatured(); }}
          disabled={isLoading}
          className="p-2 text-muted hover:text-foreground hover:bg-surface rounded-lg transition disabled:opacity-50"
          title="Refresh"
        >
          <svg className={cn("w-4 h-4", isLoading && "animate-spin")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
      <p className="text-muted text-sm mb-6">{t('browse.subtitle')}</p>

      {/* Featured section */}
      {featuredProjects.length > 0 && !search && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            <h2 className="text-sm font-semibold text-accent">{t('browse.featured')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featuredProjects.slice(0, 3).map((project) => (
              <ProjectCard
                key={`featured-${project.id}`}
                project={project}
                onClick={() => { trackView(project.id); router.push(`/project/${project.id}`); }}
                onFork={() => handleFork(project.id)}
                onTryIt={project.published_url ? () => { trackView(project.id); window.open(project.published_url!, '_blank'); } : undefined}
                userId={user?.id}
                showActions
              />
            ))}
          </div>
        </section>
      )}

      {/* Tabs + Search */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="flex bg-surface rounded-lg p-1">
          {(['newest', 'popular'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSort(tab)}
              className={cn(
                'px-4 py-1.5 rounded-md text-sm font-medium transition',
                sort === tab
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-foreground'
              )}
            >
              {tab === 'newest' ? t('browse.newest') : t('browse.popular')}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="flex-1 max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('browse.searchPlaceholder')}
            className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-accent transition"
          />
        </form>
      </div>

      {isLoading && projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted">{t('common.loading')}</p>
        </div>
      ) : loadError && projects.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-muted mb-4">Failed to load projects. The server may be starting up.</p>
          <button
            onClick={() => loadProjects(true)}
            className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 text-muted">{t('browse.noResults')}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => { trackView(project.id); router.push(`/project/${project.id}`); }}
                onFork={() => handleFork(project.id)}
                onTryIt={project.published_url ? () => { trackView(project.id); window.open(project.published_url!, '_blank'); } : undefined}
                userId={user?.id}
                showActions
              />
            ))}
          </div>
          {hasMore && (
            <div className="text-center mt-8">
              <button
                onClick={() => loadProjects(false)}
                disabled={isLoading}
                className="px-6 py-2 bg-surface hover:bg-surface-hover border border-border rounded-xl text-sm transition"
              >
                {isLoading ? t('common.loading') : t('browse.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
