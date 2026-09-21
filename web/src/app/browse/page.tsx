'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ProjectCard } from '@/components/project/ProjectCard';
import type { ProjectSummary, BrowseResponse } from '@/types/api';
import { cn } from '@/lib/utils';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';

// Track view for a project (fire-and-forget)
function trackView(projectId: string) {
  api.post(`/api/projects/${projectId}/view`, {}).catch(() => {});
}

export default function PublicBrowsePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [featuredProjects, setFeaturedProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sort, setSort] = useState<'newest' | 'popular'>('popular');
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

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    loadProjects(true);
  }

  return (
    <div className="theme-paper min-h-screen bg-[#FAF6F1] text-[#17140F]">
      <MarketingHeader />

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* SEO-friendly heading */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold">Community Apps</h1>
            <button
              onClick={() => { loadProjects(true); loadFeatured(); }}
              disabled={isLoading}
              className="p-2 text-[#17140F]/62 hover:text-[#17140F] hover:bg-[#17140F]/4 rounded-lg transition disabled:opacity-50"
              title="Refresh"
            >
              <svg className={cn("w-5 h-5", isLoading && "animate-spin")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
          <p className="text-[#17140F]/62 text-lg">
            Discover web apps built by the VibeBuild community. Browse, try live demos, and fork projects to make them your own.
          </p>
        </div>

        {/* Featured section */}
        {featuredProjects.length > 0 && !search && (
          <section className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1.5 h-1.5 bg-[#5B4CFF] rounded-full animate-pulse" />
              <h2 className="text-sm font-semibold text-[#5B4CFF]">Featured Apps</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {featuredProjects.slice(0, 6).map((project) => (
                <ProjectCard
                  key={`featured-${project.id}`}
                  project={project}
                  onClick={() => {
                    trackView(project.id);
                    if (project.published_url) window.open(project.published_url, '_blank');
                  }}
                  onTryIt={project.published_url ? () => {
                    trackView(project.id);
                    window.open(project.published_url!, '_blank');
                  } : undefined}
                  showActions={false}
                />
              ))}
            </div>
          </section>
        )}

        {/* Tabs + Search */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <div className="flex bg-[#17140F]/4 rounded-lg p-1">
            {(['popular', 'newest'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSort(tab)}
                className={cn(
                  'px-4 py-1.5 rounded-md text-sm font-medium transition',
                  sort === tab
                    ? 'bg-[#5B4CFF] text-white'
                    : 'text-[#17140F]/62 hover:text-[#17140F]'
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
              placeholder="Search community apps..."
              className="w-full px-4 py-2 bg-[#17140F]/4 border border-[#17140F]/12 rounded-xl text-sm focus:outline-none focus:border-[#5B4CFF] transition"
            />
          </form>
        </div>

        {/* Project Grid */}
        {isLoading && projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-[#5B4CFF] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#17140F]/62">Loading community apps...</p>
          </div>
        ) : loadError && projects.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[#17140F]/62 mb-4">Failed to load projects. The server may be starting up.</p>
            <button
              onClick={() => loadProjects(true)}
              className="px-5 py-2 bg-[#5B4CFF] hover:bg-[#4638D6] text-white text-sm font-semibold rounded-xl transition inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 text-[#17140F]/62">No projects found</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onClick={() => {
                    trackView(project.id);
                    if (project.published_url) window.open(project.published_url, '_blank');
                  }}
                  onTryIt={project.published_url ? () => {
                    trackView(project.id);
                    window.open(project.published_url!, '_blank');
                  } : undefined}
                  onFork={() => router.push('/signup')}
                  showActions
                />
              ))}
            </div>
            {hasMore && (
              <div className="text-center mt-8">
                <button
                  onClick={() => loadProjects(false)}
                  disabled={isLoading}
                  className="px-6 py-2 bg-[#17140F]/4 hover:bg-[#17140F]/7 border border-[#17140F]/12 rounded-xl text-sm transition"
                >
                  {isLoading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}

        {/* CTA */}
        <div className="mt-16 text-center py-12 border-t border-[#17140F]/12">
          <h2 className="text-2xl font-bold mb-3">Want to build your own app?</h2>
          <p className="text-[#17140F]/62 mb-6">Describe what you want and VibeBuild will generate it in minutes — no coding required.</p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3.5 bg-[#5B4CFF] hover:bg-[#4638D6] text-white font-semibold rounded-xl transition text-lg shadow-lg shadow-[#5B4CFF]/20"
          >
            Start Building Free
          </Link>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
