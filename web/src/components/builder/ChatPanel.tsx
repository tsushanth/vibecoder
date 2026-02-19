'use client';

import { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useGenerationStore } from '@/stores/generationStore';
import { cn } from '@/lib/utils';
import { PHASE_LABELS } from '@/lib/constants';

interface ChatPanelProps {
  onTweak: (description: string) => void;
  disabled?: boolean;
}

export function ChatPanel({ onTweak, disabled }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const { chatMessages } = useProjectStore();
  const { isGenerating, phase, progressPercent, message } = useGenerationStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      <div className="flex-1 overflow-auto px-4 py-3 space-y-3 min-h-0">
        {chatMessages.length === 0 && !isGenerating && (
          <p className="text-xs text-subtle text-center py-2">
            Describe changes to iterate on your app
          </p>
        )}
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'text-xs rounded-lg px-3 py-2 max-w-[80%]',
              msg.role === 'user'
                ? 'bg-accent/10 text-accent ml-auto'
                : 'bg-surface text-foreground'
            )}
          >
            {msg.content}
          </div>
        ))}
        {isGenerating && (
          <div className="bg-surface rounded-lg px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-accent font-medium">
                {PHASE_LABELS[phase] || 'Working'}
              </span>
              <span className="text-subtle">{Math.round(progressPercent)}%</span>
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
          placeholder="Describe changes..."
          disabled={isGenerating || disabled}
          className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-accent transition disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || isGenerating || disabled}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
