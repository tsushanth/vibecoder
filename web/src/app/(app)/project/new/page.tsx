'use client';

import { useRef, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useProjectStore } from '@/stores/projectStore';
import { PromptInput } from '@/components/builder/PromptInput';
import { GenerationProgress } from '@/components/builder/GenerationProgress';
import { PreviewPane } from '@/components/builder/PreviewPane';
import { streamSSE } from '@/lib/sse';
import { extractBundle, buildFileTree, createPreviewUrl } from '@/lib/zip';
import { api, ApiError } from '@/lib/api';
import type { SaveProjectResponse } from '@/types/api';

export default function NewProjectPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const {
    isGenerating,
    bundle,
    startGeneration,
    updateProgress,
    setResult,
    setError,
    reset,
  } = useGenerationStore();
  const {
    setExtractedFiles,
    setBundle,
    setPreviewUrl,
    previewUrl,
  } = useProjectStore();
  const abortRef = useRef<AbortController | null>(null);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [usageLimitError, setUsageLimitError] = useState<string | null>(null);

  const handleGenerate = useCallback(
    async (prompt: string, referenceImage?: string) => {
      if (!user) return;

      // Check usage limits before generating
      try {
        await api.post('/api/subscriptions/usage', {
          userId: user.id,
          actionType: 'generation',
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          const data = err.data as { remaining?: number; limit?: number; currentTier?: string };
          setUsageLimitError(
            `Daily generation limit reached (${data.limit || 3}/day on ${data.currentTier || 'Free'} plan). Upgrade to Pro for unlimited generations.`
          );
          return;
        }
      }

      setSavedProjectId(null);
      setSaveError(null);
      setUsageLimitError(null);
      startGeneration();
      abortRef.current = new AbortController();

      try {
        const stream = streamSSE(
          '/api/projects/generate',
          {
            prompt,
            userId: user.id,
            userName:
              user.user_metadata?.full_name || user.email?.split('@')[0],
            framework: 'react',
            referenceImage,
          },
          abortRef.current.signal
        );

        for await (const event of stream) {
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
            setResult({
              bundle: event.bundle,
              bundleSize: event.bundleSize,
              generationTime: event.generationTime,
              generationId: event.generationId,
            });

            // Extract and preview
            try {
              const files = await extractBundle(event.bundle);
              const tree = buildFileTree(files);
              setExtractedFiles(files, tree);
              setBundle(event.bundle);
              const url = createPreviewUrl(files);
              setPreviewUrl(url);
            } catch (extractErr) {
              console.error('Bundle extraction failed:', extractErr);
              // Still set the bundle so the preview screen shows
              setBundle(event.bundle);
            }

            // Auto-save in background — don't auto-navigate, show preview first
            const title =
              prompt.length > 60
                ? prompt.substring(0, 60).trim() + '...'
                : prompt;
            try {
              const saveData = await api.post<SaveProjectResponse>(
                '/api/projects/save',
                {
                  title,
                  description: prompt,
                  bundle: event.bundle,
                  creatorId: user.id,
                  creatorName:
                    user.user_metadata?.full_name ||
                    user.email?.split('@')[0] ||
                    'Anonymous',
                  initialPrompt: prompt,
                  isPublic: true,
                }
              );
              setSavedProjectId(saveData.projectId);
            } catch (err) {
              console.error('Save failed:', err);
              setSaveError(err instanceof Error ? err.message : 'Save failed');
            }
          } else if (event.type === 'error') {
            setError(event.error);
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(
            err instanceof Error ? err.message : 'Generation failed'
          );
        }
      }
    },
    [user, startGeneration, updateProgress, setResult, setError, setExtractedFiles, setBundle, setPreviewUrl]
  );

  // Show preview + action buttons after generation completes
  if (bundle && !isGenerating) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between bg-card">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <p className="text-sm text-success font-medium">
              App generated successfully!
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saveError && (
              <span className="text-xs text-danger">{saveError}</span>
            )}
            <button
              onClick={() => {
                reset();
                useProjectStore.getState().reset();
                setSavedProjectId(null);
                setSaveError(null);
              }}
              className="px-3 py-1.5 text-sm bg-surface hover:bg-surface-hover border border-border rounded-lg transition"
            >
              Build Another
            </button>
            {savedProjectId ? (
              <button
                onClick={() => router.push(`/project/${savedProjectId}`)}
                className="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white font-semibold rounded-lg transition"
              >
                Open in Builder
              </button>
            ) : !saveError ? (
              <span className="text-xs text-muted">Saving...</span>
            ) : null}
          </div>
        </div>
        <div className="flex-1">
          <PreviewPane />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      {/* Usage limit modal */}
      {usageLimitError && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setUsageLimitError(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Limit Reached</h3>
            <p className="text-sm text-muted mb-6">{usageLimitError}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setUsageLimitError(null)}
                className="flex-1 px-4 py-2 border border-border hover:bg-surface rounded-xl text-sm font-medium transition"
              >
                OK
              </button>
              <button
                onClick={() => {
                  setUsageLimitError(null);
                  router.push('/settings');
                }}
                className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition"
              >
                Upgrade
              </button>
            </div>
          </div>
        </div>
      )}

      {isGenerating ? (
        <div className="w-full max-w-md">
          <GenerationProgress />
          <div className="text-center mt-4">
            <button
              onClick={() => abortRef.current?.abort()}
              className="px-4 py-2 text-sm text-subtle hover:text-foreground border border-border rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <PromptInput onSubmit={handleGenerate} isGenerating={isGenerating} />
      )}
    </div>
  );
}
