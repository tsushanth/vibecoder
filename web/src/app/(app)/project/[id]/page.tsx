'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Panel,
  Group,
  Separator,
} from 'react-resizable-panels';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { useGenerationStore } from '@/stores/generationStore';
import { api } from '@/lib/api';
import { streamSSE } from '@/lib/sse';
import {
  extractBundle,
  buildFileTree,
  createPreviewUrl,
} from '@/lib/zip';
import { FileTree } from '@/components/builder/FileTree';
import { CodeEditor } from '@/components/builder/CodeEditor';
import { PreviewPane } from '@/components/builder/PreviewPane';
import { ChatPanel } from '@/components/builder/ChatPanel';
import type {
  ProjectDetailResponse,
  VersionsResponse,
  DeploymentInfoResponse,
} from '@/types/api';

export default function ProjectBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const router = useRouter();
  const store = useProjectStore();
  const genStore = useGenerationStore();
  const abortRef = useRef<AbortController | null>(null);

  // Load project on mount
  useEffect(() => {
    if (!id || !user) return;
    loadProject();
    return () => {
      store.reset();
      genStore.reset();
    };
  }, [id, user]);

  async function loadProject() {
    store.setLoading(true);
    try {
      const data = await api.get<ProjectDetailResponse>(
        `/api/projects/${id}`
      );
      store.setProject(data.project);

      if (data.project.bundle) {
        const files = await extractBundle(data.project.bundle);
        const tree = buildFileTree(files);
        store.setExtractedFiles(files, tree);
        store.setBundle(data.project.bundle);
        const url = createPreviewUrl(files);
        store.setPreviewUrl(url);
      }

      // Load versions in background
      api
        .get<VersionsResponse>(
          `/api/projects/${id}/versions?limit=20`
        )
        .then((v) => store.setVersions(v.versions))
        .catch(() => {});
    } catch (err) {
      console.error('Failed to load project:', err);
    } finally {
      store.setLoading(false);
    }
  }

  const handleTweak = useCallback(
    async (description: string) => {
      if (!user || !id) return;

      store.addChatMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        content: description,
        timestamp: Date.now(),
      });

      genStore.startGeneration();
      abortRef.current = new AbortController();

      try {
        const stream = streamSSE(
          `/api/projects/${id}/tweak`,
          {
            userId: user.id,
            tweakDescription: description,
          },
          abortRef.current.signal
        );

        for await (const event of stream) {
          if (event.type === 'status') {
            genStore.updateProgress({
              phase: event.phase,
              message: event.message,
              detail: event.detail,
              progressPercent: event.progressPercent,
              progressEndPct: event.progressEndPct,
              phaseDurationSeconds: event.phaseDurationSeconds,
              estimatedSecondsRemaining: event.estimatedSecondsRemaining,
            });
          } else if (event.type === 'result' && event.success) {
            genStore.setResult({
              bundle: event.bundle,
              bundleSize: event.bundleSize,
              generationTime: event.generationTime,
            });

            // Update files and preview
            const files = await extractBundle(event.bundle);
            const tree = buildFileTree(files);
            store.setExtractedFiles(files, tree);
            store.setBundle(event.bundle);

            // Revoke old URL before creating new one
            if (store.previewUrl) {
              URL.revokeObjectURL(store.previewUrl);
            }
            const url = createPreviewUrl(files);
            store.setPreviewUrl(url);

            store.addChatMessage({
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: `Changes applied successfully (${event.generationTime || '?'}s)`,
              timestamp: Date.now(),
            });

            // Refresh versions
            api
              .get<VersionsResponse>(
                `/api/projects/${id}/versions?limit=20`
              )
              .then((v) => store.setVersions(v.versions))
              .catch(() => {});
          } else if (event.type === 'error') {
            genStore.setError(event.error);
            store.addChatMessage({
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${event.error}`,
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const msg =
            err instanceof Error ? err.message : 'Tweak failed';
          genStore.setError(msg);
          store.addChatMessage({
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: `Error: ${msg}`,
            timestamp: Date.now(),
          });
        }
      }
    },
    [user, id, store, genStore]
  );

  const isOwner = store.project?.creatorId === user?.id;

  if (store.isLoadingProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!store.project) {
    return (
      <div className="h-full flex items-center justify-center text-muted">
        Project not found
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-subtle hover:text-foreground transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-sm font-semibold truncate max-w-[200px]">
            {store.project.title}
          </h1>
          {!isOwner && (
            <span className="px-2 py-0.5 bg-surface text-subtle text-[10px] rounded-full">
              Read-only
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {store.project.publishedUrl && (
            <a
              href={store.project.publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs text-accent hover:bg-accent/10 rounded-lg transition"
            >
              View Live
            </a>
          )}
        </div>
      </div>

      {/* Main builder area */}
      <div className="flex-1 min-h-0">
        <Group orientation="vertical">
          <Panel defaultSize={70} minSize={30}>
            <Group orientation="horizontal">
              {/* File tree */}
              <Panel defaultSize={15} minSize={10} maxSize={25}>
                <div className="h-full border-r border-border bg-card overflow-auto">
                  <FileTree />
                </div>
              </Panel>

              <Separator className="w-1 bg-border hover:bg-accent transition" />

              {/* Code editor */}
              <Panel defaultSize={42} minSize={20}>
                <CodeEditor />
              </Panel>

              <Separator className="w-1 bg-border hover:bg-accent transition" />

              {/* Preview */}
              <Panel defaultSize={43} minSize={20}>
                <PreviewPane />
              </Panel>
            </Group>
          </Panel>

          <Separator className="h-1 bg-border hover:bg-accent transition" />

          {/* Chat panel */}
          <Panel defaultSize={30} minSize={15} maxSize={50}>
            <ChatPanel
              onTweak={handleTweak}
              disabled={!isOwner}
            />
          </Panel>
        </Group>
      </div>
    </div>
  );
}
