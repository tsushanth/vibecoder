'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/stores/projectStore';
import { useGenerationStore } from '@/stores/generationStore';

interface ChatPanelProps {
  onTweak: (description: string) => void;
  // Version load is handled by VersionsPopover in the toolbar now, but we
  // keep the callback in the props so parent wiring doesn't have to change.
  onLoadVersion: (sha: string) => void;
  disabled?: boolean;
}

export function ChatPanel({ onTweak, disabled }: ChatPanelProps) {
  const t = useTranslations();
  const [input, setInput] = useState('');
  const { chatMessages, isReverting } = useProjectStore();
  const { isGenerating, phase, progressPercent, message } = useGenerationStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const PHASE_LABELS: Record<string, string> = {
    generating: t('generation.phases.generating'),
    validating: t('generation.phases.validating'),
    fixing: t('generation.phases.fixing'),
    polishing: t('generation.phases.polishing'),
    verifying: t('generation.phases.verifying'),
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isGenerating]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isGenerating || disabled) return;
    onTweak(input.trim());
    setInput('');
  }

  return (
    <div className="flex h-full flex-col border-t border-border bg-card">
      {/* Input sits at the TOP of the chat panel so "Describe a change" is immediately visible rather than buried below
          message history. shrink-0 so it can't be clipped. */}
      <form onSubmit={handleSubmit} className="flex shrink-0 gap-2 border-b border-border bg-card p-3">
        <label htmlFor="chat-tweak" className="sr-only">
          {t('chat.placeholder')}
        </label>
        <input
          id="chat-tweak"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? t('chat.readOnlyPlaceholder') : t('chat.placeholder')}
          disabled={isGenerating || disabled || isReverting}
          className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-foreground outline-none transition placeholder:text-subtle focus:border-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || isGenerating || disabled || isReverting}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-accent-deep disabled:bg-surface disabled:text-subtle"
          aria-label={t('common.send')}
          title={t('common.send')}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
      </form>

      {/* Pinned generation status: sits between the input and the history while a tweak is in flight, so the person always
          sees what is happening without scrolling. */}
      {isGenerating && (
        <div className="shrink-0 border-b border-border px-3 py-2.5" aria-live="polite">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
            <span className="font-medium text-foreground">{PHASE_LABELS[phase] || t('generation.working')}</span>
            {progressPercent > 0 && <span className="tabular-nums text-muted">{Math.round(progressPercent)}%</span>}
          </div>
          {message && <p className="ml-5.5 mt-1 truncate text-sm text-muted">{message}</p>}
          {progressPercent > 0 && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.round(progressPercent))}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-4 py-3">
        {chatMessages.length === 0 && !isGenerating && (
          <p className="py-4 text-center text-sm text-muted">{t('chat.emptyHint')}</p>
        )}
        {chatMessages.map((msg) => {
          // Version-bearing assistant messages live in the Versions menu; skip them here to keep the chat on the conversation.
          if (msg.role === 'assistant' && msg.versionSha) {
            return null;
          }

          if (msg.role === 'assistant' && msg.content.startsWith('Error:')) {
            return (
              <p key={msg.id} className="max-w-[85%] text-sm text-danger">
                {msg.content}
              </p>
            );
          }

          if (msg.role === 'assistant') {
            return (
              <p key={msg.id} className="max-w-[85%] text-sm text-foreground">
                {msg.content}
              </p>
            );
          }

          return (
            <div
              key={msg.id}
              className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-tr-sm bg-surface px-3 py-2 text-sm text-foreground"
            >
              {msg.content}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
