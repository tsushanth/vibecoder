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
    <div className="flex flex-col h-full bg-card border-t border-border">
      {/* Input — sits at the TOP of the chat panel so "Describe a change"
          is immediately visible at the top of the panel rather than buried
          below message history. shrink-0 so it can't be clipped. */}
      <form onSubmit={handleSubmit} className="shrink-0 p-3 border-b border-border flex gap-2 bg-card">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? t('chat.readOnlyPlaceholder') : t('chat.placeholder')}
          disabled={isGenerating || disabled || isReverting}
          className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-accent transition disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || isGenerating || disabled || isReverting}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
        >
          {t('common.send')}
        </button>
      </form>

      {/* Pinned generation banner — sits between the input and the message
          history while a tweak is in flight, so the user always sees what's
          happening without having to scroll to the bottom of the chat. */}
      {isGenerating && (
        <div className="shrink-0 px-3 py-2.5 border-b border-border bg-accent/5">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-accent font-semibold">
              {PHASE_LABELS[phase] || t('generation.working')}
            </span>
            {progressPercent > 0 && (
              <span className="text-accent/70 font-medium">{Math.round(progressPercent)}%</span>
            )}
          </div>
          {message && (
            <p className="text-[11px] text-subtle mt-1 ml-5 truncate">{message}</p>
          )}
          {progressPercent > 0 && (
            <div className="mt-2 h-1 bg-accent/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.round(progressPercent))}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-2.5 min-h-0">
        {chatMessages.length === 0 && !isGenerating && (
          <p className="text-xs text-subtle text-center py-4">
            {t('chat.emptyHint')}
          </p>
        )}
        {chatMessages.map((msg) => {
          // Version-bearing assistant messages now live in the top-right
          // Versions dropdown — skip rendering them here to keep the chat
          // focused on the prompt-response conversation.
          if (msg.role === 'assistant' && msg.versionSha) {
            return null;
          }

          // Error message
          if (msg.role === 'assistant' && msg.content.startsWith('Error:')) {
            return (
              <div
                key={msg.id}
                className="text-xs rounded-lg px-3 py-2 bg-danger/10 text-danger border border-danger/20"
              >
                {msg.content}
              </div>
            );
          }

          // Regular assistant message (no version)
          if (msg.role === 'assistant') {
            return (
              <div
                key={msg.id}
                className="text-xs rounded-lg px-3 py-2 bg-surface text-foreground"
              >
                {msg.content}
              </div>
            );
          }

          // User message
          return (
            <div
              key={msg.id}
              className="text-xs rounded-lg px-3 py-2 max-w-[85%] bg-accent/10 text-accent ml-auto"
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
