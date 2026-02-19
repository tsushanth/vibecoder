'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { api, ApiError } from '@/lib/api';
import { ProjectCard } from '@/components/project/ProjectCard';
import type { ProjectSummary, BrowseResponse, ForkResponse } from '@/types/api';
import { cn } from '@/lib/utils';

export default function BrowsePage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sort, setSort] = useState<'newest' | 'popular'>('newest');
  const [search, setSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    loadProjects(true);
  }, [sort]);

  async function loadProjects(reset = false) {
    setIsLoading(true);
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
      <h1 className="text-2xl font-bold mb-6">Browse Apps</h1>

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
              {tab === 'newest' ? 'Newest' : 'Popular'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="flex-1 max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-accent transition"
          />
        </form>
      </div>

      {isLoading && projects.length === 0 ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 text-muted">No projects found</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => router.push(`/project/${project.id}`)}
                onFork={() => handleFork(project.id)}
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
                {isLoading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
