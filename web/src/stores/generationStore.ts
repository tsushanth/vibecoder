import { create } from 'zustand';

interface GenerationState {
  isGenerating: boolean;
  phase: string;
  message: string;
  detail: string;
  progressPercent: number;
  progressEndPct: number;
  phaseDurationSeconds: number;
  estimatedSecondsRemaining: number | null;
  error: string | null;
  bundle: string | null;
  bundleSize: number;
  generationTime: string | null;
  generationId: string | null;

  startGeneration: () => void;
  updateProgress: (data: {
    phase: string;
    message: string;
    detail: string;
    progressPercent: number;
    progressEndPct: number;
    phaseDurationSeconds?: number;
    estimatedSecondsRemaining?: number;
  }) => void;
  setResult: (data: {
    bundle: string;
    bundleSize: number;
    generationTime?: string;
    generationId?: string;
  }) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initialState = {
  isGenerating: false,
  phase: '',
  message: '',
  detail: '',
  progressPercent: 0,
  progressEndPct: 0,
  phaseDurationSeconds: 0,
  estimatedSecondsRemaining: null as number | null,
  error: null as string | null,
  bundle: null as string | null,
  bundleSize: 0,
  generationTime: null as string | null,
  generationId: null as string | null,
};

export const useGenerationStore = create<GenerationState>((set) => ({
  ...initialState,

  startGeneration: () =>
    set({
      ...initialState,
      isGenerating: true,
    }),

  updateProgress: (data) =>
    set({
      phase: data.phase,
      message: data.message,
      detail: data.detail,
      progressPercent: data.progressPercent,
      progressEndPct: data.progressEndPct,
      phaseDurationSeconds: data.phaseDurationSeconds ?? 0,
      estimatedSecondsRemaining: data.estimatedSecondsRemaining ?? null,
    }),

  setResult: (data) =>
    set({
      isGenerating: false,
      bundle: data.bundle,
      bundleSize: data.bundleSize,
      generationTime: data.generationTime ?? null,
      generationId: data.generationId ?? null,
      progressPercent: 100,
    }),

  setError: (error) =>
    set({
      isGenerating: false,
      error,
    }),

  reset: () => set(initialState),
}));
