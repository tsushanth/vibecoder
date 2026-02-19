'use client';

import { useGenerationStore } from '@/stores/generationStore';
import { PHASE_LABELS } from '@/lib/constants';

export function GenerationProgress() {
  const { phase, message, detail, progressPercent, estimatedSecondsRemaining } =
    useGenerationStore();

  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;
  const phaseLabel = PHASE_LABELS[phase] || phase || 'Starting';
  const isIndeterminate = progressPercent === 0;

  return (
    <div className="flex flex-col items-center justify-center py-12 animate-fade-in">
      {/* Circular progress */}
      <div className="relative w-36 h-36 mb-6">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
          {/* Background ring */}
          <circle
            cx="64"
            cy="64"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="6"
          />
          {/* Progress ring */}
          {isIndeterminate ? (
            <circle
              cx="64"
              cy="64"
              r={radius}
              fill="none"
              stroke="#3B82F6"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${circumference * 0.25} ${circumference * 0.75}`}
              className="animate-spin origin-center"
              style={{ transformOrigin: '64px 64px', animationDuration: '1.5s' }}
            />
          ) : (
            <circle
              cx="64"
              cy="64"
              r={radius}
              fill="none"
              stroke="#3B82F6"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-500 ease-out"
            />
          )}
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isIndeterminate ? (
            <>
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mb-1" />
              <span className="text-xs text-muted">Initializing</span>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold">{Math.round(progressPercent)}%</span>
              <span className="text-xs text-muted mt-0.5">{phaseLabel}</span>
            </>
          )}
        </div>
      </div>

      {/* Status text */}
      <p className="text-sm font-medium text-foreground mb-1">
        {message || 'Connecting to build server...'}
      </p>
      {detail && (
        <p className="text-xs text-muted max-w-md text-center">{detail}</p>
      )}

      {/* ETA */}
      {estimatedSecondsRemaining != null && estimatedSecondsRemaining > 0 && (
        <p className="text-xs text-subtle mt-3">
          ~{Math.ceil(estimatedSecondsRemaining)}s remaining
        </p>
      )}
    </div>
  );
}
