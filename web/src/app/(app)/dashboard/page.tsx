'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/authStore';
import { api, ApiError } from '@/lib/api';
import { ProjectCard } from '@/components/project/ProjectCard';
import type { ProjectSummary, MyProjectsResponse } from '@/types/api';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const t = useTranslations();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadProjects();
  }, [user]);

  async function loadProjects() {
    if (!user) return;
    setIsLoading(true);
    try {
      const data = await api.get<MyProjectsResponse>(
        `/api/projects/my?userId=${user.id}`
      );
      setProjects(data.projects);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(projectId: string) {
    if (!user || !confirm(t('dashboard.confirmDelete'))) return;
    try {
      await api.delete(`/api/projects/${projectId}`, { userId: user.id });
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      if (err instanceof ApiError) alert(err.message);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
          <p className="text-muted text-sm mt-1">
            {t('dashboard.projectCount', { count: projects.length })}
          </p>
        </div>
        <button
          onClick={() => router.push('/project/new')}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition flex items-center gap-2"
        >
          <span>+</span> {t('common.newProject')}
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4 opacity-30">📱</div>
          <h2 className="text-xl font-semibold mb-2">{t('dashboard.noAppsYet')}</h2>
          <p className="text-muted mb-6">{t('dashboard.noAppsHint')}</p>
          <button
            onClick={() => router.push('/project/new')}
            className="px-6 py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition"
          >
            {t('dashboard.createFirstApp')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => router.push(`/project/${project.id}`)}
              onDelete={() => handleDelete(project.id)}
              showActions
            />
          ))}
        </div>
      )}
    </div>
  );
}
