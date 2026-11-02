export interface SSEStatusEvent {
  type: 'status';
  phase: string;
  message: string;
  detail: string;
  progressPercent: number;
  progressEndPct: number;
  phaseDurationSeconds?: number;
  estimatedSecondsRemaining?: number;
}

/** Sent right after the backend creates the project row for this build. */
export interface SSEQueuedEvent {
  type: 'queued';
  projectId: string;
}

export interface SSEResultEvent {
  type: 'result';
  success: boolean;
  /** The project row the backend already saved this build to. Absent from older backends. */
  projectId?: string | null;
  generationId?: string;
  bundle: string;
  bundleSize: number;
  files?: SSEProjectFile[];
  generationTime?: string;
  quality?: {
    criticalIssues: number;
    warnings: number;
    phasesCompleted: number;
  };
  commitSha?: string;
  tier?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  unlimited?: boolean;
}

export interface SSEErrorEvent {
  type: 'error';
  error: string;
  quotaExhausted?: boolean;
  resetTime?: string;
  systemBusy?: boolean;
}

export interface SSEProjectFile {
  name: string;
  path: string;
  size: number;
  type: string;
}

export type SSEEvent = SSEQueuedEvent | SSEStatusEvent | SSEResultEvent | SSEErrorEvent;
