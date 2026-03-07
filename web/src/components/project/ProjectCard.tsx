'use client';

import { useState } from 'react';
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

// Deterministic gradient based on project title
function getGradient(title: string) {
  const gradients = [
    'from-violet-600/40 to-indigo-600/40',
    'from-blue-600/40 to-cyan-600/40',
    'from-emerald-600/40 to-teal-600/40',
    'from-orange-600/40 to-amber-600/40',
    'from-pink-600/40 to-rose-600/40',
    'from-purple-600/40 to-fuchsia-600/40',
  ];
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
  return gradients[Math.abs(hash) % gradients.length];
}

export function ProjectCard({
  project,
  onClick,
  onDelete,
  onFork,
  onTryIt,
  showActions = false,
}: ProjectCardProps) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState(false);

  const hasLivePreview = project.published_url && !iframeError;

  return (
    <div
      onClick={onClick}
      className="group bg-card border border-border rounded-xl overflow-hidden cursor-pointer hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5 transition-all duration-200"
    >
      {/* Thumbnail */}
      <div className="aspect-video relative overflow-hidden">
        {hasLivePreview ? (
          <>
            {/* Live iframe preview */}
            <div className="absolute inset-0 origin-top-left" style={{ width: '400%', height: '400%', transform: 'scale(0.25)' }}>
              <iframe
                src={project.published_url!}
                title={project.title}
                className="w-full h-full border-0"
                loading="lazy"
                sandbox="allow-scripts allow-same-origin"
                onLoad={() => setIframeLoaded(true)}
                onError={() => setIframeError(true)}
                tabIndex={-1}
              />
            </div>
            {/* Loading overlay */}
            {!iframeLoaded && (
              <div className={`absolute inset-0 bg-gradient-to-br ${getGradient(project.title)} flex items-center justify-center`}>
                <div className="w-5 h-5 border-2 border-white/40 border-t-white/80 rounded-full animate-spin" />
              </div>
            )}
            {/* Prevent clicks on iframe */}
            <div className="absolute inset-0" />
          </>
        ) : (
          /* Branded gradient placeholder */
          <div className={`absolute inset-0 bg-gradient-to-br ${getGradient(project.title)} flex items-center justify-center`}>
            <div className="flex flex-col items-center gap-1.5">
              <svg className="w-8 h-8 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <span className="text-[10px] text-white/25 font-medium tracking-wide uppercase">
                {project.project_type === 'web_app' ? 'Web App' : 'Project'}
              </span>
            </div>
          </div>
        )}

        {/* Live badge */}
        {project.published_url && (
          <div className="absolute top-2 right-2 px-2 py-0.5 bg-success/20 text-success text-xs rounded-full flex items-center gap-1 backdrop-blur-sm">
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
          <p className="text-xs text-muted line-clamp-2 mb-1.5 leading-relaxed">
            {project.description}
          </p>
        )}
        {project.published_url && (
          <a
            href={project.published_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-accent/70 hover:text-accent hover:underline truncate block mb-1.5"
          >
            {project.published_url.replace('https://', '')}
          </a>
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
