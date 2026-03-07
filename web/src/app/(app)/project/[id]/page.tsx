'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
import { PublishDialog } from '@/components/builder/PublishDialog';
import type {
  ProjectDetailResponse,
  ProjectVersion,
  VersionsResponse,
  RevertResponse,
} from '@/types/api';
import type { ChatMessage } from '@/types/project';

function buildChatFromVersions(
  versions: ProjectVersion[],
  initialPrompt: string | null,
  t: ReturnType<typeof useTranslations>
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
      content: isFirst ? t('project.initialGeneration') : t('project.changesApplied'),
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
  const t = useTranslations();
  const { id } = useParams<{ id: string }>();
  const { user, subscription } = useAuthStore();
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
          data.project.initialPrompt,
          t
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

          // Detect usage limit errors from backend 403
          if (msg.includes('limited to') || msg.includes('limit') || msg.includes('Upgrade')) {
            setUsageLimitError(msg);
            genStore.reset();
            // Remove the optimistic user message
            const messages = useProjectStore.getState().chatMessages;
            store.setChatMessages(messages.slice(0, -1));
          } else {
            genStore.setError(msg);
            store.addChatMessage({
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${msg}`,
              timestamp: Date.now(),
            });
          }
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

  const [showPublish, setShowPublish] = useState(false);
  const [usageLimitError, setUsageLimitError] = useState<string | null>(null);

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
        {t('project.notFound')}
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
              {t('common.readOnly')}
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
              {t('common.viewLive')}
            </a>
          )}
          {isOwner && (
            <button
              onClick={() => setShowPublish(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {store.project.publishedUrl ? t('common.manage') : t('common.publish')}
            </button>
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

      {/* Tweak usage limit modal */}
      {usageLimitError && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setUsageLimitError(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">{t('project.tweakLimitReached')}</h3>
            <p className="text-sm text-muted mb-6">{usageLimitError}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setUsageLimitError(null)}
                className="flex-1 px-4 py-2 border border-border hover:bg-surface rounded-xl text-sm font-medium transition"
              >
                {t('common.ok')}
              </button>
              <button
                onClick={() => { setUsageLimitError(null); router.push('/settings'); }}
                className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition"
              >
                {t('common.upgrade')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPublish && user && (
        <PublishDialog
          projectId={id}
          userId={user.id}
          subscriptionTier={subscription?.tier || 'free'}
          onClose={() => setShowPublish(false)}
          onPublished={(url) => {
            if (store.project) {
              store.setProject({ ...store.project, publishedUrl: url || null });
            }
          }}
        />
      )}
    </div>
  );
}
