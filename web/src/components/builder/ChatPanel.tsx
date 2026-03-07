'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/stores/projectStore';
import { useGenerationStore } from '@/stores/generationStore';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/types/project';

interface ChatPanelProps {
  onTweak: (description: string) => void;
  onLoadVersion: (sha: string) => void;
  disabled?: boolean;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function VersionCard({
  msg,
  isActive,
  isReverting,
  onLoad,
  disabled,
  t,
}: {
  msg: ChatMessage;
  isActive: boolean;
  isReverting: boolean;
  onLoad: () => void;
  disabled: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2.5 text-xs border transition',
        isActive
          ? 'border-accent/40 bg-accent/5'
          : 'border-border bg-surface hover:border-accent/20'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold',
              isActive
                ? 'bg-accent text-white'
                : 'bg-surface-hover text-subtle'
            )}
          >
            {msg.versionNumber}
          </span>
          <span className="text-foreground truncate">
            {msg.content}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-subtle">
            {formatDate(msg.timestamp)}
          </span>
          {isActive ? (
            <span className="text-[10px] text-accent font-medium px-1.5 py-0.5 bg-accent/10 rounded">
              {t('common.current')}
            </span>
          ) : msg.versionSha && !disabled ? (
            <button
              onClick={onLoad}
              disabled={isReverting}
              className="text-[10px] text-accent font-medium px-1.5 py-0.5 bg-accent/10 hover:bg-accent/20 rounded transition disabled:opacity-50"
            >
              {isReverting ? '...' : t('common.load')}
            </button>
          ) : null}
        </div>
      </div>
      {msg.versionSha && (
        <span className="text-[9px] text-subtle font-mono mt-1 block">
          {msg.versionSha.slice(0, 7)}
        </span>
      )}
    </div>
  );
}

export function ChatPanel({ onTweak, onLoadVersion, disabled }: ChatPanelProps) {
  const t = useTranslations();
  const [input, setInput] = useState('');
  const { chatMessages, activeVersionSha, isReverting } = useProjectStore();
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
      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-2.5 min-h-0">
        {chatMessages.length === 0 && !isGenerating && (
          <p className="text-xs text-subtle text-center py-4">
            {t('chat.emptyHint')}
          </p>
        )}
        {chatMessages.map((msg) => {
          // Version card (assistant message with version info)
          if (msg.role === 'assistant' && msg.versionSha) {
            const isActive = msg.versionSha === activeVersionSha;
            return (
              <VersionCard
                key={msg.id}
                msg={msg}
                isActive={isActive}
                isReverting={isReverting}
                onLoad={() => onLoadVersion(msg.versionSha!)}
                disabled={!!disabled}
                t={t}
              />
            );
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
        {isGenerating && (
          <div className="bg-surface rounded-lg px-3 py-2.5 text-xs border border-border">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-accent font-medium">
                {PHASE_LABELS[phase] || t('generation.working')}
              </span>
              {progressPercent > 0 && (
                <span className="text-subtle">{Math.round(progressPercent)}%</span>
              )}
            </div>
            {message && (
              <p className="text-subtle mt-1">{message}</p>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-border flex gap-2">
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
    </div>
  );
}
