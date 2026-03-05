'use client';

import type { ProjectSummary } from '@/types/api';
import { formatDate } from '@/lib/utils';

interface ProjectCardProps {
  project: ProjectSummary;
  onClick?: () => void;
  onDelete?: () => void;
  onFork?: () => void;
  onTryIt?: () => void;
  showActions?: boolean;
}

export function ProjectCard({
  project,
  onClick,
  onDelete,
  onFork,
  onTryIt,
  showActions = false,
}: ProjectCardProps) {
  return (
    <div
      onClick={onClick}
      className="group bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-accent/30 transition"
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-surface flex items-center justify-center relative">
        <span className="text-4xl opacity-30">📱</span>
        {project.published_url && (
          <div className="absolute top-2 right-2 px-2 py-0.5 bg-success/20 text-success text-xs rounded-full flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
            Live
          </div>
        )}
        {/* Try it button overlay */}
        {onTryIt && project.published_url && (
          <button
            onClick={(e) => { e.stopPropagation(); onTryIt(); }}
            className="absolute bottom-2 right-2 px-3 py-1 bg-accent hover:bg-accent-hover text-white text-xs font-semibold rounded-lg opacity-0 group-hover:opacity-100 transition shadow-lg"
          >
            Try it →
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-semibold text-sm truncate mb-1">{project.title}</h3>

        {/* Creator + description */}
        {project.creator_name && (
          <p className="text-xs text-accent/80 mb-1">by {project.creator_name}</p>
        )}
        {project.description && (
          <p className="text-xs text-muted line-clamp-2 mb-2 leading-relaxed">
            {project.description}
          </p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-subtle">
            <span>{project.is_public ? '🌐' : '🔒'}</span>
            {project.play_count > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                {project.play_count}
              </span>
            )}
            {project.fork_count > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                </svg>
                {project.fork_count}
              </span>
            )}
            <span>{formatDate(project.created_at)}</span>
          </div>
          {showActions && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
              {onFork && (
                <button
                  onClick={(e) => { e.stopPropagation(); onFork(); }}
                  className="p-1 hover:bg-surface rounded text-subtle hover:text-foreground"
                  title="Fork"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                  </svg>
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 hover:bg-danger/10 rounded text-subtle hover:text-danger"
                  title="Delete"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
