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
  ProjectVersion,
  VersionsResponse,
  RevertResponse,
} from '@/types/api';
import type { ChatMessage } from '@/types/project';

function buildChatFromVersions(
  versions: ProjectVersion[],
  initialPrompt: string | null
): { messages: ChatMessage[]; latestSha: string | null } {
  if (versions.length === 0) {
    if (initialPrompt) {
      return {
        messages: [
          {
            id: 'initial-prompt',
            role: 'user',
            content: initialPrompt,
            timestamp: Date.now(),
          },
        ],
        latestSha: null,
      };
    }
    return { messages: [], latestSha: null };
  }

  const sorted = [...versions].reverse(); // oldest first
  const messages: ChatMessage[] = [];

  sorted.forEach((version, index) => {
    const versionNum = index + 1;
    const isFirst = index === 0;
    const ts = new Date(version.date).getTime();

    // User message
    if (isFirst && initialPrompt) {
      messages.push({
        id: `user-${version.sha}`,
        role: 'user',
        content: initialPrompt,
        timestamp: ts,
      });
    } else {
      const desc = version.message.replace(/^Tweak:\s*/i, '');
      messages.push({
        id: `user-${version.sha}`,
        role: 'user',
        content: desc,
        timestamp: ts,
      });
    }

    // Assistant version card
    messages.push({
      id: `version-${version.sha}`,
      role: 'assistant',
      content: isFirst ? 'Initial generation' : 'Changes applied',
      timestamp: ts,
      versionSha: version.sha,
      versionNumber: versionNum,
    });
  });

  return {
    messages,
    latestSha: sorted[sorted.length - 1]?.sha ?? null,
  };
}

export default function ProjectBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const router = useRouter();
  const store = useProjectStore();
  const genStore = useGenerationStore();
  const abortRef = useRef<AbortController | null>(null);

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

      // Load versions and reconstruct chat
      try {
        const v = await api.get<VersionsResponse>(
          `/api/projects/${id}/versions?limit=50`
        );
        store.setVersions(v.versions);
        const { messages, latestSha } = buildChatFromVersions(
          v.versions,
          data.project.initialPrompt
        );
        store.setChatMessages(messages);
        store.setActiveVersion(latestSha);
      } catch {
        // No versions — still show initial prompt in chat
        if (data.project.initialPrompt) {
          store.setChatMessages([
            {
              id: 'initial-prompt',
              role: 'user',
              content: data.project.initialPrompt,
              timestamp: new Date(data.project.createdAt).getTime(),
            },
          ]);
        }
      }
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

            if (store.previewUrl) {
              URL.revokeObjectURL(store.previewUrl);
            }
            const url = createPreviewUrl(files);
            store.setPreviewUrl(url);

            // Determine new version number
            const currentVersionCount = useProjectStore.getState().chatMessages
              .filter((m) => m.versionSha)
              .length;
            const newVersionNum = currentVersionCount + 1;

            store.addChatMessage({
              id: `version-${event.commitSha || Date.now()}`,
              role: 'assistant',
              content: `Changes applied${event.generationTime ? ` in ${event.generationTime}s` : ''}`,
              timestamp: Date.now(),
              versionSha: event.commitSha,
              versionNumber: newVersionNum,
            });

            if (event.commitSha) {
              store.setActiveVersion(event.commitSha);
            }

            // Refresh version list
            api
              .get<VersionsResponse>(
                `/api/projects/${id}/versions?limit=50`
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

  const handleLoadVersion = useCallback(
    async (sha: string) => {
      if (!user || !id) return;

      store.setReverting(true);
      try {
        const result = await api.post<RevertResponse>(
          `/api/projects/${id}/revert/${sha}`,
          { userId: user.id }
        );

        const files = await extractBundle(result.bundle);
        const tree = buildFileTree(files);
        store.setExtractedFiles(files, tree);
        store.setBundle(result.bundle);

        if (store.previewUrl) {
          URL.revokeObjectURL(store.previewUrl);
        }
        const url = createPreviewUrl(files);
        store.setPreviewUrl(url);
        store.setActiveVersion(sha);
      } catch (err) {
        console.error('Failed to load version:', err);
      } finally {
        store.setReverting(false);
      }
    },
    [user, id, store]
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
          {store.activeVersionSha && (
            <span className="text-[10px] text-subtle font-mono">
              {store.activeVersionSha.slice(0, 7)}
            </span>
          )}
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
              <Panel defaultSize={15} minSize={10} maxSize={25}>
                <div className="h-full border-r border-border bg-card overflow-auto">
                  <FileTree />
                </div>
              </Panel>

              <Separator className="w-1 bg-border hover:bg-accent transition" />

              <Panel defaultSize={42} minSize={20}>
                <CodeEditor />
              </Panel>

              <Separator className="w-1 bg-border hover:bg-accent transition" />

              <Panel defaultSize={43} minSize={20}>
                <PreviewPane />
              </Panel>
            </Group>
          </Panel>

          <Separator className="h-1 bg-border hover:bg-accent transition" />

          <Panel defaultSize={30} minSize={15} maxSize={50}>
            <ChatPanel
              onTweak={handleTweak}
              onLoadVersion={handleLoadVersion}
              disabled={!isOwner}
            />
          </Panel>
        </Group>
      </div>
    </div>
  );
}
