'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import Link from 'next/link';
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
import { api, ApiError } from '@/lib/api';
import { streamSSE } from '@/lib/sse';
import { cn } from '@/lib/utils';
import {
  extractBundle,
  buildFileTree,
  createPreviewHtml,
} from '@/lib/zip';
import { PreviewPane } from '@/components/builder/PreviewPane';
import { ChatPanel } from '@/components/builder/ChatPanel';
import { PublishDialog } from '@/components/builder/PublishDialog';
import { SecretsPanel } from '@/components/project/SecretsPanel';
import { UsagePanel } from '@/components/project/UsagePanel';
import { VersionsPopover } from '@/components/builder/VersionsPopover';
import { shortAddress, useRelativeTime } from '@/components/project/ProjectCard';
import type {
  DomainStatusResponse,
  ForkResponse,
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

type ExportApkResponse = { success: boolean; apk?: string; apkSize?: number; error?: string };

function downloadBase64(base64: string, fileName: string, type: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function suggestSubdomain(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

export default function ProjectBuilderPage() {
  const t = useTranslations();
  const ta = useTranslations('apps');
  const ago = useRelativeTime();
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
        store.setPreviewHtml(createPreviewHtml(files));
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

            store.setPreviewHtml(createPreviewHtml(files));

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
            genStore.setError(event.error, event.systemBusy);
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

        store.setPreviewHtml(createPreviewHtml(files));
        store.setActiveVersion(sha);
      } catch (err) {
        console.error('Failed to load version:', err);
      } finally {
        store.setReverting(false);
      }
    },
    [user, id, store]
  );

  const [mode, setMode] = useState<'overview' | 'build'>('overview');
  const [showPublish, setShowPublish] = useState(false);
  const [publishOpenCount, setPublishOpenCount] = useState(0); // re-reads the domain status after the dialog closes
  const [usageLimitError, setUsageLimitError] = useState<string | null>(null);
  const [showPublishNudge, setShowPublishNudge] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [isRemixing, setIsRemixing] = useState(false);
  const [remixError, setRemixError] = useState<string | null>(null);

  const isOwner = store.project?.creatorId === user?.id;

  // Surface a one-time nudge right after a successful generation finishes,
  // if the project isn't published yet. Most successful builds never get
  // published — the Publish button is small and easy to miss, and nothing
  // prompts the user at the moment they'd be most likely to act on it.
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (
      wasGenerating.current &&
      !genStore.isGenerating &&
      !genStore.error &&
      isOwner &&
      !store.project?.publishedUrl
    ) {
      setShowPublishNudge(true);
    }
    wasGenerating.current = genStore.isGenerating;
  }, [genStore.isGenerating, genStore.error, isOwner, store.project?.publishedUrl]);

  async function handleExportApk() {
    if (!user || !store.project || isExporting) return;
    setIsExporting(true);
    setExportNote(null);
    try {
      const r = await api.post<ExportApkResponse>(`/api/projects/${id}/export-apk`, {
        userId: user.id,
        ...(store.bundle ? { bundle: store.bundle } : {}),
      });
      if (!r.success || !r.apk) throw new Error(r.error || '');
      const name = store.project.title.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_') || 'app';
      downloadBase64(r.apk, `${name}.apk`, 'application/vnd.android.package-archive');
      setExportNote({ kind: 'ok', text: ta('exportDone') });
    } catch (err) {
      const detail = err instanceof Error ? err.message : '';
      setExportNote({ kind: 'error', text: detail ? ta('exportFailedWith', { error: detail }) : ta('exportFailed') });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleShare(url: string) {
    const text = ta('shareText', { url });
    try {
      if (navigator.share) {
        await navigator.share({ title: store.project?.title, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareNote(ta('addressCopied'));
      setTimeout(() => setShareNote(null), 2500);
    } catch {
      // the share sheet was dismissed
    }
  }

  async function handleRemix() {
    if (!user || isRemixing) return;
    setIsRemixing(true);
    setRemixError(null);
    try {
      const data = await api.post<ForkResponse>(`/api/projects/${id}/fork`, {
        userId: user.id,
        userName: user.user_metadata?.full_name || user.email?.split('@')[0],
      });
      router.push(`/project/${data.projectId}`);
    } catch (err) {
      setRemixError(err instanceof ApiError ? err.message : ta('remixFailed'));
      setIsRemixing(false);
    }
  }

  if (store.isLoadingProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!store.project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-muted">{ta('notFound')}</p>
        <Link href="/dashboard" className="flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface">
          {ta('backToApps')}
        </Link>
      </div>
    );
  }

  const project = store.project;
  const liveUrl = project.publishedUrl;
  const panelsReloadKey = `${genStore.isGenerating ? 'generating' : 'idle'}:${project.publishedUrl ?? ''}`;

  const publishNudge = showPublishNudge && isOwner && !liveUrl && (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
      <span className="text-foreground">{ta('publishNudge')}</span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => { setShowPublishNudge(false); setShowPublish(true); }}
          className="h-9 rounded-lg bg-accent px-3 font-semibold text-white transition hover:bg-accent-hover"
        >
          {ta('publishShort')}
        </button>
        <button
          onClick={() => setShowPublishNudge(false)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-subtle transition hover:bg-surface hover:text-foreground"
          aria-label={t('common.dismiss')}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );

  const dialogs = (
    <>
      {/* Tweak usage limit modal */}
      {usageLimitError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/80" onClick={() => setUsageLimitError(null)} />
          <div role="alertdialog" aria-modal="true" aria-labelledby="limit-title" className="relative w-full max-w-sm rounded-xl border border-border bg-card p-5">
            <h3 id="limit-title" className="font-display text-lg font-semibold">{ta('limitTitle')}</h3>
            <p className="mt-2 text-muted">{usageLimitError}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setUsageLimitError(null)}
                className="h-10 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-surface"
              >
                {ta('notNow')}
              </button>
              <button
                onClick={() => { setUsageLimitError(null); router.push('/settings'); }}
                className="h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:bg-accent-hover"
              >
                {ta('upgrade')}
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
          suggestedSubdomain={suggestSubdomain(project.title)}
          onClose={() => { setShowPublish(false); setPublishOpenCount((n) => n + 1); }}
          onPublished={(url) => {
            if (store.project) {
              store.setProject({ ...store.project, publishedUrl: url || null });
            }
          }}
        />
      )}
    </>
  );

  // ---- Build mode: the full preview with the change box, as Android's "Preview and change" screen
  if (mode === 'build') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
          <div className="flex min-w-0 items-center gap-1">
            <button
              onClick={() => setMode('overview')}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-foreground transition hover:bg-surface"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {ta('done')}
            </button>
            <h1 className="truncate font-display text-[15px] font-semibold">{project.title}</h1>
            {!isOwner && (
              <span className="hidden shrink-0 rounded-lg bg-surface px-2 py-0.5 text-xs text-muted sm:inline">{ta('readOnly')}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <VersionsPopover
              versions={store.versions}
              activeVersionSha={store.activeVersionSha}
              isReverting={store.isReverting}
              disabled={!isOwner}
              onLoad={handleLoadVersion}
            />
            {liveUrl && (
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden h-9 items-center rounded-lg px-3 text-sm text-accent-hover transition hover:bg-surface sm:flex"
              >
                {ta('openLive')}
              </a>
            )}
            {isOwner && (
              <button
                onClick={() => setShowPublish(true)}
                className="h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-white transition hover:bg-accent-hover"
              >
                {liveUrl ? ta('publishUpdateShort') : ta('publishShort')}
              </button>
            )}
          </div>
        </div>

        {publishNudge && <div className="border-b border-border p-2">{publishNudge}</div>}

        {/* Desktop: preview on top, the change box below. (react-resizable-panels 4 reads bare numbers as pixels, so sizes are percentages in strings.) */}
        <div className="hidden md:flex flex-1 min-h-0">
          <Group orientation="vertical" className="w-full">
            <Panel defaultSize="55%" minSize="25%">
              <PreviewPane />
            </Panel>
            <Separator className="h-1 bg-border hover:bg-accent transition" />
            <Panel defaultSize="45%" minSize="25%" maxSize="75%">
              <ChatPanel onTweak={handleTweak} onLoadVersion={handleLoadVersion} disabled={!isOwner} />
            </Panel>
          </Group>
        </div>

        {/* Phones: preview on top, the change box fixed below. */}
        <div className="flex md:hidden flex-1 min-h-0 flex-col">
          <div className="flex-1 min-h-0">
            <PreviewPane />
          </div>
          <div className="shrink-0 h-[45vh] border-t border-border flex flex-col">
            <ChatPanel onTweak={handleTweak} onLoadVersion={handleLoadVersion} disabled={!isOwner} />
          </div>
        </div>

        {dialogs}
      </div>
    );
  }

  // ---- Overview: the preview as the hero, then the actions, then the sections
  const secondaryBtn = 'flex h-10 items-center gap-2 rounded-lg border border-border px-3.5 text-[15px] font-medium text-foreground transition hover:bg-surface disabled:opacity-60';

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-8">
      <Link href="/dashboard" className="-ml-2 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted transition hover:bg-surface hover:text-foreground">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {ta('backToApps')}
      </Link>

      <div className="mt-3 grid gap-8 md:grid-cols-[300px_minmax(0,1fr)] md:gap-12 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-14">
        <div className="md:sticky md:top-8 md:self-start">
          <PhoneFrame
            title={project.title}
            html={store.previewHtml}
            url={liveUrl}
            onOpen={() => setMode('build')}
          />
        </div>

        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">{project.title}</h1>
          {project.description && <p className="mt-2 max-w-[62ch] text-muted">{project.description}</p>}
          <p className="mt-2 flex flex-wrap gap-x-3 text-sm text-muted">
            {!isOwner && project.creatorName && <span>{ta('byCreator', { name: project.creatorName })}</span>}
            <span>{ta('createdAt', { time: ago(project.createdAt) })}</span>
            {project.viewCount > 0 && <span>{ta('views', { count: project.viewCount })}</span>}
            {project.forkCount > 0 && <span>{ta('remixes', { count: project.forkCount })}</span>}
          </p>

          {/* where the app lives */}
          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {liveUrl ? (
              <>
                <span className="flex items-center gap-2 text-success">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  {ta('status.published')}
                </span>
                <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-accent-hover hover:underline">
                  {shortAddress(liveUrl)}
                </a>
              </>
            ) : (
              <span className="flex items-center gap-2 text-muted">
                <span className="h-2 w-2 rounded-full bg-subtle" />
                {ta('notPublished')}
              </span>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              onClick={() => setMode('build')}
              className="flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[15px] font-semibold text-white transition hover:bg-accent-hover"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5L8 5.5z" /></svg>
              {isOwner ? ta('previewAndChange') : ta('preview')}
            </button>
            {isOwner && (
              <button onClick={() => setShowPublish(true)} className={secondaryBtn}>
                <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
                </svg>
                {liveUrl ? ta('managePublishing') : ta('publishToWeb')}
              </button>
            )}
            {isOwner && (
              <button onClick={() => void handleExportApk()} disabled={isExporting} className={secondaryBtn}>
                {isExporting ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                ) : (
                  <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="6.5" y="2.75" width="11" height="18.5" rx="2.25" strokeWidth={1.75} />
                    <path strokeLinecap="round" strokeWidth={1.75} d="M10.5 18h3" />
                  </svg>
                )}
                {isExporting ? ta('exporting') : ta('exportAndroid')}
              </button>
            )}
            {liveUrl && (
              <button onClick={() => void handleShare(liveUrl)} className={secondaryBtn}>
                <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 15V3m0 0L8 7m4-4l4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                </svg>
                {ta('share')}
              </button>
            )}
            {!isOwner && (
              <button onClick={() => void handleRemix()} disabled={isRemixing} className={secondaryBtn}>
                {isRemixing ? ta('remixing') : ta('remix')}
              </button>
            )}
          </div>

          <div aria-live="polite" className="mt-3 space-y-1 text-sm empty:hidden">
            {isExporting && <p className="text-muted">{ta('exportingHint')}</p>}
            {exportNote && <p className={exportNote.kind === 'ok' ? 'text-success' : 'text-danger'}>{exportNote.text}</p>}
            {shareNote && <p className="text-success">{shareNote}</p>}
            {remixError && <p className="text-danger">{remixError}</p>}
          </div>

          {publishNudge && <div className="mt-4">{publishNudge}</div>}

          <div className="mt-8">
            {isOwner && user && <SecretsPanel projectId={id} reloadKey={panelsReloadKey} />}
            {isOwner && user && <UsagePanel projectId={id} reloadKey={panelsReloadKey} />}
            {isOwner && user && (
              <DomainSection
                projectId={id}
                userId={user.id}
                published={!!liveUrl}
                reloadKey={publishOpenCount}
                onManage={() => setShowPublish(true)}
              />
            )}
            <VersionsSection
              versions={store.versions}
              activeSha={store.activeVersionSha}
              isReverting={store.isReverting}
              canRestore={isOwner}
              onUse={handleLoadVersion}
            />
            {project.initialPrompt && (
              <section className="border-t border-border py-6">
                <h2 className="font-display text-lg font-semibold">{ta('promptTitle')}</h2>
                <p className="mt-2 max-w-[66ch] whitespace-pre-wrap text-muted">{project.initialPrompt}</p>
              </section>
            )}
          </div>
        </div>
      </div>

      {dialogs}
    </div>
  );
}

/** The app running inside a phone outline. Tapping the screen opens the full preview. */
function PhoneFrame({ title, html, url, onOpen }: { title: string; html: string | null; url: string | null; onOpen: () => void }) {
  const ta = useTranslations('apps');
  const hasPreview = !!html || !!url;
  return (
    <div className="mx-auto w-[224px] md:w-full">
      <div className="rounded-[28px] border border-border bg-card p-2">
        <div className="relative h-[400px] overflow-hidden rounded-[20px] bg-surface md:h-[620px]">
          {html ? (
            <iframe srcDoc={html} sandbox="allow-scripts" title={ta('previewOf', { title })} className="h-full w-full border-0 bg-white" />
          ) : url ? (
            <iframe src={url} sandbox="allow-scripts allow-same-origin allow-forms" title={ta('previewOf', { title })} className="h-full w-full border-0 bg-white" loading="lazy" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="font-display text-5xl font-semibold text-accent-hover/70">{(title.trim().charAt(0) || '?').toUpperCase()}</span>
              <p className="text-sm text-muted">{ta('noPreview')}</p>
            </div>
          )}
        </div>
      </div>
      {hasPreview && (
        <button onClick={onOpen} className="mx-auto mt-2 flex h-10 items-center rounded-lg px-3 text-sm text-muted transition hover:bg-surface hover:text-foreground">
          {ta('openFullPreview')}
        </button>
      )}
    </div>
  );
}

/** Custom domain: what is connected now, and the way into the publish dialog where it is set up. */
function DomainSection({ projectId, userId, published, reloadKey, onManage }: { projectId: string; userId: string; published: boolean; reloadKey: number; onManage: () => void }) {
  const ta = useTranslations('apps');
  const [status, setStatus] = useState<DomainStatusResponse | null>(null);

  useEffect(() => {
    if (!published) return;
    let cancelled = false;
    api.get<DomainStatusResponse>(`/api/domains/${projectId}?userId=${userId}`)
      .then((d) => { if (!cancelled) setStatus(d); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, [projectId, userId, published, reloadKey]);

  const domain = published && status?.hasDomain ? status.domain : null; // an unpublished app keeps no domain on screen
  const state = status?.status;
  return (
    <section className="flex flex-col gap-3 border-t border-border py-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="font-display text-lg font-semibold">{ta('domainTitle')}</h2>
        {domain ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-3">
            <span className="text-foreground">{domain}</span>
            <span className={cn('text-sm', state === 'active' ? 'text-success' : 'text-warning')}>
              {state === 'active' ? ta('domainActive') : state === 'verified' ? ta('domainVerified') : ta('domainPending')}
            </span>
          </p>
        ) : (
          <p className="mt-1 max-w-[60ch] text-muted">{published ? ta('domainNone') : ta('domainNeedsPublish')}</p>
        )}
      </div>
      {published && (
        <button onClick={onManage} className="flex h-10 shrink-0 items-center self-start rounded-lg border border-border px-4 text-[15px] font-medium transition hover:bg-surface">
          {domain ? ta('domainManage') : ta('domainConnect')}
        </button>
      )}
    </section>
  );
}

const VERSIONS_SHOWN = 5;

/** Every saved version, newest first, with a way back to an earlier one (Android's version history). */
function VersionsSection({ versions, activeSha, isReverting, canRestore, onUse }: { versions: ProjectVersion[]; activeSha: string | null; isReverting: boolean; canRestore: boolean; onUse: (sha: string) => void }) {
  const ta = useTranslations('apps');
  const ago = useRelativeTime();
  const [all, setAll] = useState(false);
  const sorted = [...versions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const total = sorted.length;
  const shown = all ? sorted : sorted.slice(0, VERSIONS_SHOWN);

  return (
    <section className="border-t border-border py-6">
      <h2 className="font-display text-lg font-semibold">{ta('versionsTitle')}</h2>
      {total === 0 ? (
        <p className="mt-1 text-muted">{ta('versionsEmpty')}</p>
      ) : (
        <>
          <ol className="mt-3 divide-y divide-border">
            {shown.map((v, i) => {
              const n = total - i;
              const active = v.sha === activeSha || (!activeSha && i === 0);
              return (
                <li key={v.sha} className="flex items-center gap-3 py-2.5">
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums', active ? 'bg-accent text-white' : 'bg-surface text-muted')}>
                    {n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground">{v.message.replace(/^Tweak:\s*/i, '').trim() || ta('versionLabel', { n })}</p>
                    <p className="text-xs text-muted">{ago(v.date)}</p>
                  </div>
                  {active ? (
                    <span className="shrink-0 text-sm text-accent-hover">{ta('versionCurrent')}</span>
                  ) : canRestore ? (
                    <button
                      onClick={() => onUse(v.sha)}
                      disabled={isReverting}
                      className="-mr-3 h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-accent-hover transition hover:bg-surface disabled:opacity-50"
                    >
                      {ta('versionUse')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {total > VERSIONS_SHOWN && (
            <button onClick={() => setAll((x) => !x)} className="-ml-2 mt-2 h-10 rounded-lg px-2 text-sm text-muted transition hover:bg-surface hover:text-foreground">
              {all ? ta('versionsFewer') : ta('versionsAll', { count: total })}
            </button>
          )}
        </>
      )}
    </section>
  );
}
