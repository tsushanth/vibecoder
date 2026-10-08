'use client';

import { useRef, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/authStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useProjectStore } from '@/stores/projectStore';
import { PromptInput } from '@/components/builder/PromptInput';
import { GenerationProgress } from '@/components/builder/GenerationProgress';
import { PreviewPane } from '@/components/builder/PreviewPane';
import { PublishDialog } from '@/components/builder/PublishDialog';
import { VersionsPopover } from '@/components/builder/VersionsPopover';
import { streamSSE } from '@/lib/sse';
import { extractBundle, buildFileTree, createPreviewHtml } from '@/lib/zip';
import { api, ApiError } from '@/lib/api';
import type { SaveProjectResponse, VersionsResponse, RevertResponse } from '@/types/api';

type Stage = 'idle' | 'planning' | 'planReady' | 'building' | 'ready' | 'failed';

interface BuildPlan {
  summary: string;
  features: string[];
  style: string;
}

interface TweakTurn {
  id: string;
  text: string;
  /** null while running, true when applied, false when it failed */
  done: boolean | null;
  error?: string;
}

/** The landing page carries a typed prompt across sign-in under this key. */
const PENDING_PROMPT_KEY = 'vb_pending_prompt';
const PLAN_TIMEOUT_MS = 10_000;
const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const getDesktopServer = () => false;

/** A free-tier limit from the backend (usage check 403/402, or a stream refusal whose text names the limit). */
function isPlanLimit(err: unknown): boolean {
  if (err instanceof ApiError) {
    const d = err.data || {};
    if (d.upgrade === true || err.status === 402) return true;
    return err.status === 403 && ('limit' in d || 'requiresTier' in d || 'currentTier' in d);
  }
  if (err instanceof Error) {
    const m = err.message;
    return /limited to|upgrade/i.test(m) && !/rate limit/i.test(m);
  }
  return false;
}

/** Accepts the plan endpoint's shape and drops anything malformed, so a bad response just skips the plan step. */
function normalizePlan(raw: unknown): BuildPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  const features = Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === 'string' && f.trim() !== '') : [];
  const style = typeof r.style === 'string' ? r.style.trim() : '';
  if (!summary && features.length === 0) return null;
  return { summary, features, style };
}

export default function NewProjectPage() {
  const t = useTranslations();
  const { user, subscription } = useAuthStore();
  const router = useRouter();
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktop, getDesktopServer);
  const { isGenerating, detail: genDetail, message: genMessage, startGeneration, updateProgress, setResult, setError, stopGeneration, reset } = useGenerationStore();
  const { setExtractedFiles, setBundle, setPreviewHtml, previewHtml, versions, activeVersionSha, isReverting } = useProjectStore();

  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0); // bumps on every new build, cancel or reset so late events from an old run are ignored
  const threadEndRef = useRef<HTMLDivElement>(null);
  const tweakInputRef = useRef<HTMLTextAreaElement>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [draft, setDraft] = useState<{ prompt: string; image?: string; focus: boolean; key: number }>({ prompt: '', focus: false, key: 0 });
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatImage, setChatImage] = useState<string | undefined>();
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [buildStartedAt, setBuildStartedAt] = useState<number | null>(null);
  const [buildFinishedAt, setBuildFinishedAt] = useState<number | null>(null);
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [failure, setFailure] = useState<{ message: string; busy: boolean } | null>(null);
  const [tweaks, setTweaks] = useState<TweakTurn[]>([]);
  const [tweakText, setTweakText] = useState('');
  const [isTweaking, setIsTweaking] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  // A prompt typed on the landing page before sign-in: prefill and focus the composer once, never start the build.
  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_PROMPT_KEY);
      if (pending !== null) sessionStorage.removeItem(PENDING_PROMPT_KEY);
    } catch {}
    if (pending && pending.trim()) {
      setDraft((d) => ({ prompt: pending!.slice(0, 2000), focus: true, key: d.key + 1 }));
    }
  }, []);

  // Leaving the page stops a running build stream.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [stage, plan, buildLog.length, tweaks, savedProjectId, saveError]);

  useEffect(() => {
    if (!previewOpen || isDesktop) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPreviewOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewOpen, isDesktop]);

  function goToUpgrade() {
    router.push('/upgrade');
  }

  async function sendFeedback(rating: 'up' | 'down') {
    if (!savedProjectId || !user) return;
    setFeedback(rating);
    try {
      await api.post(`/api/projects/${savedProjectId}/feedback`, { userId: user.id, rating });
    } catch {}
  }

  /** Back to the empty composer, keeping what the person typed so they can change it. */
  function backToComposer(prompt: string, image?: string) {
    runRef.current++;
    abortRef.current?.abort();
    reset();
    setStage('idle');
    setPlan(null);
    setFailure(null);
    setDraft((d) => ({ prompt, image, focus: true, key: d.key + 1 }));
  }

  const beginBuild = useCallback(
    async (prompt: string, referenceImage?: string) => {
      if (!user) return;
      const run = ++runRef.current;

      // Flip to the progress view immediately, before the usage-check round trip, so Build gives instant feedback.
      setStage('building');
      setSavedProjectId(null);
      setSaveError(null);
      setFailure(null);
      setFeedback(null);
      setBuildLog([]);
      setBuildStartedAt(Date.now());
      setBuildFinishedAt(null);
      startGeneration();

      // Check usage limits before kicking off the (more expensive) generation. A free-tier limit goes to the Upgrade screen.
      try {
        await api.post('/api/subscriptions/usage', { userId: user.id, actionType: 'generation' });
      } catch (err) {
        if (run !== runRef.current) return;
        if (isPlanLimit(err)) {
          stopGeneration();
          backToComposer(prompt, referenceImage);
          goToUpgrade();
          return;
        }
      }
      if (run !== runRef.current) return;

      abortRef.current = new AbortController();

      try {
        const stream = streamSSE(
          '/api/projects/generate',
          {
            prompt,
            userId: user.id,
            userName: user.user_metadata?.full_name || user.email?.split('@')[0],
            framework: 'react',
            referenceImage,
            // The backend defaults to an async queued+poll flow (the mobile app's model); this client only understands the
            // held-open SSE stream, which the backend still proxies when asked. Without this, generate silently returns to
            // idle after a single "queued" event with no progress and no error.
            stream: true,
          },
          abortRef.current.signal
        );

        for await (const event of stream) {
          if (run !== runRef.current) return;
          if (event.type === 'status') {
            updateProgress({
              phase: event.phase,
              message: event.message,
              detail: event.detail,
              progressPercent: event.progressPercent,
              progressEndPct: event.progressEndPct,
              phaseDurationSeconds: event.phaseDurationSeconds,
              estimatedSecondsRemaining: event.estimatedSecondsRemaining,
            });
            const line = (event.message || '').trim();
            if (line) setBuildLog((log) => (log[log.length - 1] === line ? log : [...log, line].slice(-8)));
          } else if (event.type === 'result' && event.success) {
            setResult({
              bundle: event.bundle,
              bundleSize: event.bundleSize,
              generationTime: event.generationTime,
              generationId: event.generationId,
            });

            try {
              const files = await extractBundle(event.bundle);
              const tree = buildFileTree(files);
              setExtractedFiles(files, tree);
              setBundle(event.bundle);
              setPreviewHtml(createPreviewHtml(files));
            } catch (extractErr) {
              console.error('Bundle extraction failed:', extractErr);
              // Still set the bundle so the ready state shows
              setBundle(event.bundle);
            }
            if (run !== runRef.current) return;
            setBuildFinishedAt(Date.now());
            setStage('ready');
            // Desktop has room for the preview beside the thread, so open it; on phones the person opens the sheet.
            if (getDesktop()) setPreviewOpen(true);

            // Save in the background so the app lands in Apps and can be tweaked and published.
            const title = prompt.length > 60 ? prompt.substring(0, 60).trim() + '...' : prompt;
            try {
              const saveData = await api.post<SaveProjectResponse>('/api/projects/save', {
                title,
                description: prompt,
                bundle: event.bundle,
                creatorId: user.id,
                creatorName: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
                initialPrompt: prompt,
                isPublic: true,
              });
              if (run === runRef.current) setSavedProjectId(saveData.projectId);
            } catch (err) {
              console.error('Save failed:', err);
              if (run === runRef.current) setSaveError(err instanceof Error ? err.message : t('create.ready.saveFailedGeneric'));
            }
          } else if (event.type === 'error') {
            setError(event.error, event.systemBusy);
            setFailure({ message: event.error, busy: !!event.systemBusy });
            setBuildFinishedAt(Date.now());
            setStage('failed');
          }
        }
        // The stream ended without a result or an error: say so instead of spinning forever.
        if (run === runRef.current && useGenerationStore.getState().bundle === null && !useGenerationStore.getState().error) {
          setFailure({ message: t('create.build.endedEarly'), busy: false });
          setBuildFinishedAt(Date.now());
          setStage('failed');
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError' || run !== runRef.current) return;
        if (isPlanLimit(err)) {
          backToComposer(prompt, referenceImage);
          goToUpgrade();
          return;
        }
        const message = err instanceof Error ? err.message : t('create.build.failedGeneric');
        setError(message);
        setFailure({ message, busy: false });
        setBuildFinishedAt(Date.now());
        setStage('failed');
      } finally {
        if (run === runRef.current) stopGeneration();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, startGeneration, updateProgress, setResult, setError, stopGeneration, setExtractedFiles, setBundle, setPreviewHtml, t]
  );

  /** Send: show the prompt in the thread, ask for a short plan, and fall back to building directly if planning is unavailable. */
  async function handleSubmit(prompt: string, referenceImage?: string) {
    if (!user) return;
    const run = ++runRef.current;
    useProjectStore.getState().reset();
    reset();
    setChatPrompt(prompt);
    setChatImage(referenceImage);
    setPlan(null);
    setTweaks([]);
    setPublishedUrl(null);
    setPreviewOpen(false);
    setStage('planning');

    let nextPlan: BuildPlan | null = null;
    try {
      const res = await Promise.race([
        api.post<{ success?: boolean; plan?: unknown }>('/api/projects/plan', { prompt, userId: user.id }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), PLAN_TIMEOUT_MS)),
      ]);
      nextPlan = res ? normalizePlan(res.plan) : null;
    } catch {
      nextPlan = null; // planning is optional
    }
    if (run !== runRef.current) return;
    if (nextPlan) {
      setPlan(nextPlan);
      setStage('planReady');
    } else {
      beginBuild(prompt, referenceImage);
    }
  }

  function handleCancel() {
    backToComposer(chatPrompt, chatImage);
  }

  function handleNewApp() {
    runRef.current++;
    abortRef.current?.abort();
    reset();
    useProjectStore.getState().reset();
    setStage('idle');
    setChatPrompt('');
    setChatImage(undefined);
    setPlan(null);
    setFailure(null);
    setTweaks([]);
    setTweakText('');
    setIsTweaking(false);
    setSavedProjectId(null);
    setSaveError(null);
    setFeedback(null);
    setPreviewOpen(false);
    setPublishedUrl(null);
    setBuildLog([]);
    setDraft((d) => ({ prompt: '', focus: true, key: d.key + 1 }));
  }

  const refreshVersions = useCallback((projectId: string) => {
    api
      .get<VersionsResponse>(`/api/projects/${projectId}/versions?limit=50`)
      .then((v) => useProjectStore.getState().setVersions(v.versions))
      .catch(() => {});
  }, []);

  async function handleTweak() {
    const desc = tweakText.trim();
    if (!desc || !user || !savedProjectId || isTweaking) return;
    const projectId = savedProjectId;
    const run = runRef.current;
    const turnId = `t-${Date.now()}`;
    setTweakText('');
    setTweaks((list) => [...list, { id: turnId, text: desc, done: null }]);
    setIsTweaking(true);
    startGeneration();
    abortRef.current = new AbortController();

    const finish = (done: boolean, error?: string) =>
      setTweaks((list) => list.map((turn) => (turn.id === turnId ? { ...turn, done, error } : turn)));

    try {
      const stream = streamSSE(`/api/projects/${projectId}/tweak`, { userId: user.id, tweakDescription: desc }, abortRef.current.signal);
      for await (const event of stream) {
        if (run !== runRef.current) return;
        if (event.type === 'status') {
          updateProgress({
            phase: event.phase,
            message: event.message,
            detail: event.detail,
            progressPercent: event.progressPercent,
            progressEndPct: event.progressEndPct,
            phaseDurationSeconds: event.phaseDurationSeconds,
            estimatedSecondsRemaining: event.estimatedSecondsRemaining,
          });
        } else if (event.type === 'result' && event.success) {
          setResult({ bundle: event.bundle, bundleSize: event.bundleSize, generationTime: event.generationTime });
          try {
            const files = await extractBundle(event.bundle);
            setExtractedFiles(files, buildFileTree(files));
            setBundle(event.bundle);
            setPreviewHtml(createPreviewHtml(files));
          } catch (extractErr) {
            console.error('Bundle extraction failed:', extractErr);
            setBundle(event.bundle);
          }
          if (event.commitSha) useProjectStore.getState().setActiveVersion(event.commitSha);
          refreshVersions(projectId);
          finish(true);
        } else if (event.type === 'error') {
          setError(event.error, event.systemBusy);
          finish(false, event.error);
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError' || run !== runRef.current) return;
      if (isPlanLimit(err)) {
        // Drop the turn and keep the text, then go to the Upgrade screen.
        setTweaks((list) => list.filter((turn) => turn.id !== turnId));
        setTweakText(desc);
        goToUpgrade();
        return;
      }
      const message = err instanceof Error ? err.message : t('create.tweak.failedGeneric');
      setError(message);
      finish(false, message);
    } finally {
      if (run === runRef.current) {
        stopGeneration();
        setIsTweaking(false);
        // A turn still marked as running here means the stream closed without a result.
        setTweaks((list) => list.map((turn) => (turn.id === turnId && turn.done === null ? { ...turn, done: false } : turn)));
      }
    }
  }

  const handleLoadVersion = useCallback(
    async (sha: string) => {
      if (!user || !savedProjectId) return;
      const store = useProjectStore.getState();
      store.setReverting(true);
      try {
        const result = await api.post<RevertResponse>(`/api/projects/${savedProjectId}/revert/${sha}`, { userId: user.id });
        const files = await extractBundle(result.bundle);
        store.setExtractedFiles(files, buildFileTree(files));
        store.setBundle(result.bundle);
        store.setPreviewHtml(createPreviewHtml(files));
        store.setActiveVersion(sha);
      } catch (err) {
        console.error('Failed to load version:', err);
      } finally {
        useProjectStore.getState().setReverting(false);
      }
    },
    [user, savedProjectId]
  );

  function focusTweak() {
    tweakInputRef.current?.focus();
  }

  // ---------- empty state ----------
  if (stage === 'idle') {
    return (
      <div className="min-h-full px-4 py-10 sm:px-8 sm:py-16 lg:py-[12vh]">
        <div className="mx-auto w-full max-w-[720px]">
          <PromptInput
            key={draft.key}
            onSubmit={handleSubmit}
            isGenerating={isGenerating}
            initialPrompt={draft.prompt}
            initialImage={draft.image}
            autoFocus={draft.focus}
          />
        </div>
      </div>
    );
  }

  // ---------- thread ----------
  const hasPreview = !!previewHtml;
  const showPanel = isDesktop && previewOpen && hasPreview;
  const showSheet = !isDesktop && previewOpen && hasPreview;
  const canAct = !!savedProjectId;
  const versionsMenu =
    versions.length > 0 ? (
      <VersionsPopover
        versions={versions}
        activeVersionSha={activeVersionSha}
        isReverting={isReverting}
        disabled={isTweaking}
        onLoad={handleLoadVersion}
      />
    ) : null;

  return (
    <div className="flex h-full min-h-0">
      <section
        className={`flex min-h-0 min-w-0 flex-col ${showPanel ? 'w-[420px] shrink-0 border-r border-border xl:w-[480px]' : 'flex-1'}`}
        aria-label={t('create.thread.label')}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[680px] space-y-6 px-4 py-6 sm:px-6">
            <UserMessage text={chatPrompt} image={chatImage} />

            {stage === 'planning' && (
              <AssistantTurn>
                <WorkingLine text={t('create.plan.thinking')} />
              </AssistantTurn>
            )}

            {plan && (
              <AssistantTurn>
                <p className="font-medium text-foreground">{t('create.plan.title')}</p>
                {plan.summary && <p className="mt-1.5 max-w-[65ch] text-foreground">{plan.summary}</p>}
                {plan.features.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex gap-2.5 text-foreground">
                        <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-hover" aria-hidden />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {plan.style && <p className="mt-3 text-sm text-muted">{t('create.plan.style', { style: plan.style })}</p>}
                {stage === 'planReady' && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => beginBuild(chatPrompt, chatImage)} className={primaryButton}>
                      {t('create.plan.build')}
                    </button>
                    <button type="button" onClick={() => backToComposer(chatPrompt, chatImage)} className={secondaryButton}>
                      {t('create.plan.edit')}
                    </button>
                  </div>
                )}
              </AssistantTurn>
            )}

            {(stage === 'building' || stage === 'ready' || stage === 'failed') && (
              <AssistantTurn>
                <GenerationProgress
                  stage={stage === 'building' ? 'building' : stage === 'ready' ? 'ready' : 'failed'}
                  startedAt={buildStartedAt}
                  finishedAt={buildFinishedAt}
                  log={stage === 'building' ? buildLog.slice(0, -1) : []}
                />
              </AssistantTurn>
            )}

            {stage === 'failed' && failure && (
              <AssistantTurn>
                {failure.busy ? (
                  <>
                    <p className="font-medium text-foreground">{t('create.build.busyTitle')}</p>
                    <p className="mt-1 max-w-[65ch] text-muted">{t('create.build.busyBody')}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => beginBuild(chatPrompt, chatImage)} className={primaryButton}>
                        {t('create.build.tryAgain')}
                      </button>
                      <button type="button" onClick={goToUpgrade} className={secondaryButton}>
                        {t('create.build.seePro')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="max-w-[65ch] text-danger">{failure.message}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => backToComposer(chatPrompt, chatImage)} className={primaryButton}>
                        {t('create.build.editRetry')}
                      </button>
                      <button type="button" onClick={handleNewApp} className={secondaryButton}>
                        {t('create.build.newApp')}
                      </button>
                    </div>
                  </>
                )}
              </AssistantTurn>
            )}

            {stage === 'ready' && (
              <>
                <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
                    <p className="font-display text-xl font-semibold text-foreground">{t('create.ready.title')}</p>
                  </div>
                  <p className="mt-1.5 text-muted">
                    {saveError
                      ? t('create.ready.saveFailed', { error: saveError })
                      : savedProjectId
                        ? hasPreview
                          ? t('create.ready.saved')
                          : t('create.ready.savedNoPreview')
                        : t('create.ready.saving')}
                  </p>
                  {publishedUrl && (
                    <p className="mt-2 text-sm">
                      <span className="text-success">{t('create.ready.published')}</span>{' '}
                      <a href={publishedUrl} target="_blank" rel="noopener noreferrer" className="break-all text-accent-hover underline-offset-2 hover:underline">
                        {publishedUrl.replace(/^https?:\/\//, '')}
                      </a>
                    </p>
                  )}

                  {hasPreview && !showPanel ? (
                    <>
                      <button type="button" onClick={() => setPreviewOpen(true)} className={`${primaryButton} mt-4 w-full`}>
                        {t('create.ready.openPreview')}
                      </button>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setShowPublish(true)} disabled={!canAct} className={secondaryButton}>
                          {publishedUrl ? t('create.ready.managePublish') : t('create.ready.publish')}
                        </button>
                        <button type="button" onClick={focusTweak} disabled={!canAct} className={secondaryButton}>
                          {t('create.ready.tweak')}
                        </button>
                      </div>
                    </>
                  ) : (
                    // The preview is already beside the thread (or there is none), so Publish leads.
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setShowPublish(true)}
                        disabled={!canAct}
                        className={publishedUrl ? secondaryButton : primaryButton}
                      >
                        {publishedUrl ? t('create.ready.managePublish') : t('create.ready.publish')}
                      </button>
                      <button type="button" onClick={focusTweak} disabled={!canAct} className={secondaryButton}>
                        {t('create.ready.tweak')}
                      </button>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3">
                    {savedProjectId ? (
                      <div className="flex items-center gap-1">
                        <span className="mr-1 text-sm text-muted">
                          {feedback ? t('create.feedback.thanks') : t('create.feedback.question')}
                        </span>
                        <FeedbackButton
                          active={feedback === 'up'}
                          label={t('create.feedback.good')}
                          onClick={() => sendFeedback('up')}
                          path="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"
                        />
                        <FeedbackButton
                          active={feedback === 'down'}
                          label={t('create.feedback.bad')}
                          onClick={() => sendFeedback('down')}
                          path="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"
                        />
                      </div>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-1">
                      {savedProjectId && (
                        <button type="button" onClick={() => router.push(`/project/${savedProjectId}`)} className={quietButton}>
                          {t('create.ready.openApp')}
                        </button>
                      )}
                      <button type="button" onClick={handleNewApp} className={quietButton}>
                        {t('create.ready.newApp')}
                      </button>
                    </div>
                  </div>
                </div>

                {tweaks.map((turn, i) => (
                  <div key={turn.id} className="space-y-6">
                    <UserMessage text={turn.text} />
                    <AssistantTurn>
                      {turn.done === null ? (
                        <WorkingLine text={genDetail || genMessage || t('create.tweak.working')} />
                      ) : turn.done ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <p className="text-success">
                            {i === tweaks.length - 1 ? t('create.tweak.done') : t('create.tweak.doneVersion', { version: i + 2 })}
                          </p>
                          {i === tweaks.length - 1 && hasPreview && !showPanel && (
                            <button type="button" onClick={() => setPreviewOpen(true)} className={quietButton}>
                              {t('create.tweak.openPreview')}
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="max-w-[65ch] text-danger">
                          {turn.error ? t('create.tweak.failed', { error: turn.error }) : t('create.tweak.failedGeneric')}
                        </p>
                      )}
                    </AssistantTurn>
                  </div>
                ))}
              </>
            )}
            <div ref={threadEndRef} />
          </div>
        </div>

        {(stage === 'planning' || stage === 'building') && (
          <div className="flex shrink-0 justify-center border-t border-border px-4 py-3">
            <button type="button" onClick={handleCancel} className={secondaryButton}>
              {t('create.build.cancel')}
            </button>
          </div>
        )}

        {stage === 'ready' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleTweak();
            }}
            className="shrink-0 border-t border-border px-4 py-3 sm:px-6"
          >
            <div className="mx-auto flex w-full max-w-[680px] items-end gap-2 rounded-xl border border-border bg-surface p-1.5 pl-3 transition focus-within:border-accent/70">
              <label htmlFor="create-tweak" className="sr-only">
                {t('create.tweak.placeholder')}
              </label>
              <textarea
                id="create-tweak"
                ref={tweakInputRef}
                value={tweakText}
                onChange={(e) => setTweakText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleTweak();
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder={canAct ? t('create.tweak.placeholder') : t('create.tweak.waitForSave')}
                disabled={!canAct || isTweaking || isReverting}
                className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-foreground outline-none placeholder:text-subtle disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!canAct || isTweaking || isReverting || !tweakText.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-accent-deep disabled:bg-card disabled:text-subtle"
                aria-label={t('create.tweak.send')}
                title={t('create.tweak.send')}
              >
                {isTweaking ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                  </svg>
                )}
              </button>
            </div>
          </form>
        )}
      </section>

      {showPanel && (
        <aside className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('create.preview.title')}>
          <PreviewPane onClose={() => setPreviewOpen(false)} actions={versionsMenu} />
        </aside>
      )}

      {showSheet && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={t('create.preview.title')}>
          <PreviewPane onClose={() => setPreviewOpen(false)} actions={versionsMenu} />
        </div>
      )}

      {showPublish && user && savedProjectId && (
        <PublishDialog
          projectId={savedProjectId}
          userId={user.id}
          subscriptionTier={subscription?.tier || 'free'}
          onClose={() => setShowPublish(false)}
          onPublished={(url) => setPublishedUrl(url || null)}
        />
      )}
    </div>
  );
}

const primaryButton =
  'inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
  'inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-4 font-medium text-foreground transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50';
const quietButton =
  'inline-flex min-h-10 items-center rounded-lg px-2.5 text-sm font-medium text-accent-hover transition hover:bg-surface';

function UserMessage({ text, image }: { text: string; image?: string }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`data:image/png;base64,${image}`} alt="" className="h-24 w-auto max-w-[60%] rounded-xl border border-border object-cover" />
      )}
      <p className="w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-tr-sm bg-surface px-4 py-2.5 text-foreground">
        {text}
      </p>
    </div>
  );
}

function AssistantTurn({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/favicon-32x32.png" alt="" className="mt-0.5 h-7 w-7 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </div>
  );
}

function WorkingLine({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2.5 text-foreground" aria-live="polite">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
      {text}
    </p>
  );
}

function FeedbackButton({ active, label, onClick, path }: { active: boolean; label: string; onClick: () => void; path: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${active ? 'bg-accent/15 text-accent-hover' : 'text-muted hover:bg-surface hover:text-foreground'}`}
    >
      <svg className="h-4 w-4" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
      </svg>
    </button>
  );
}
