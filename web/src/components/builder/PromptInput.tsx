'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { api } from '@/lib/api';
import type { SuggestionsResponse } from '@/types/api';

const LOCALE_BCP47: Record<string, string> = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
  zh: 'zh-CN', ko: 'ko-KR', pt: 'pt-BR', it: 'it-IT', hi: 'hi-IN',
};

const MAX_CHARS = 2000;

// Fallback ideas when the suggestions API is unreachable. Weighted toward patterns that show up repeatedly and independently
// in real production prompts (trading/signal tracking, local service booking, drawing tools), not just generic app-category
// guesses. "Trading signal tracker" is deliberately scoped to a logging dashboard, not a broker-connected bot: that is outside
// what a generated web app can do, and promising it would just produce another failed or misleading generation.
const SAMPLE_PROMPTS = [
  { label: 'Portfolio site', prompt: 'Build a personal portfolio website with a dark theme, animated hero section, project gallery with hover effects, skills section, and a working contact form' },
  { label: 'Task manager', prompt: 'Build a Kanban-style task manager with drag and drop columns (To Do, In Progress, Done), ability to add/edit/delete tasks, priority labels, and local storage persistence' },
  { label: 'Trading signal tracker', prompt: 'Build a trading signal tracker dashboard where I can log entry/exit prices for trades, see win-rate and P&L stats, filter by symbol, and view a running watchlist, a tracking tool, not a live-execution bot' },
  { label: 'Dashboard', prompt: 'Build an analytics dashboard with sidebar navigation, chart cards showing revenue/users/orders metrics, a data table with sorting, and a dark professional theme' },
  { label: 'Service booking app', prompt: 'Build a local service booking app for home services (plumbing, cleaning, gardening) with service category cards, a calendar-based time slot picker, and a customer request form' },
  { label: 'Drawing studio', prompt: 'Build a drawing app using HTML canvas with brush size and color picker, an eraser, multiple layers, and undo/redo support' },
];

type Idea = { label: string; prompt: string };

/** Keep only well-formed ideas, so a changed API shape shows the fallback instead of empty chips. */
function cleanIdeas(list: unknown): Idea[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (s): s is Idea => !!s && typeof s.label === 'string' && s.label.trim() !== '' && typeof s.prompt === 'string' && s.prompt.trim() !== ''
  );
}

interface PromptInputProps {
  onSubmit: (prompt: string, referenceImage?: string) => void;
  isGenerating: boolean;
  /** Text to start the composer with (a prompt carried over from the landing page, or the prompt being edited). */
  initialPrompt?: string;
  /** Base64 (no data: prefix) reference image to start with, kept when the person goes back to edit their prompt. */
  initialImage?: string;
  autoFocus?: boolean;
}

const QUESTION_STARTERS = [
  'what', 'who', 'how', 'why', 'where', 'when', 'can you', 'could you',
  'is it', 'are there', 'does', 'do you', 'will it',
];
const APP_SIGNAL_WORDS = [
  'build', 'app', 'website', 'web app', 'page', 'dashboard', 'tool', 'tracker',
  'game', 'form', 'site', 'calculator', 'manager', 'store', 'shop', 'booking',
  'wallet', 'bot', 'signal', 'chat app', 'quiz', 'landing',
];

/** Heuristic only, used to gently nudge and never to block submission. A meaningful share of real prompts are general
 * chat/image questions rather than app descriptions (confirmed from production data), so this catches the common shapes of
 * that without being a hard gate. */
function looksOffTopic(prompt: string): boolean {
  const t = prompt.trim().toLowerCase();
  if (t.length === 0) return false;
  const wordCount = t.split(/\s+/).length;
  const endsWithQuestion = t.endsWith('?');
  const startsWithQuestionWord = QUESTION_STARTERS.some((q) => t.startsWith(q));
  const hasAppSignal = APP_SIGNAL_WORDS.some((w) => t.includes(w));
  if (hasAppSignal) return false;
  if (endsWithQuestion || startsWithQuestionWord) return true;
  if (wordCount <= 3) return true;
  return false;
}

export function PromptInput({ onSubmit, isGenerating, initialPrompt, initialImage, autoFocus }: PromptInputProps) {
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [apiSuggestions, setApiSuggestions] = useState<Idea[]>([]);
  const [referenceImage, setReferenceImage] = useState<string | undefined>(initialImage);
  const [isListening, setIsListening] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [hasVoiceSupport, setHasVoiceSupport] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useTranslations();
  const locale = useLocale();

  useEffect(() => {
    api
      .get<SuggestionsResponse>('/api/projects/suggestions?count=6')
      .then((data) => setApiSuggestions(cleanIdeas(data.suggestions)))
      .catch(() => {});
    setHasVoiceSupport(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);

  // Focus with the caret at the end, so a carried-over or edited prompt can be continued straight away.
  useEffect(() => {
    if (!autoFocus || !textareaRef.current) return;
    const el = textareaRef.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const suggestions = apiSuggestions.length > 0 ? apiSuggestions : SAMPLE_PROMPTS;
  const canBuild = prompt.trim().length > 0 && !isGenerating;

  async function handleSuggestNewIdeas() {
    setIsLoadingSuggestions(true);
    try {
      const data = await api.post<{ suggestions: Idea[] }>('/api/projects/suggest-ideas', {});
      const ideas = cleanIdeas(data.suggestions);
      if (ideas.length > 0) setApiSuggestions(ideas);
    } catch {
      // Fallback: reshuffle from the existing pool
      try {
        const data = await api.get<SuggestionsResponse>('/api/projects/suggestions?count=6');
        const ideas = cleanIdeas(data.suggestions);
        if (ideas.length > 0) setApiSuggestions(ideas);
      } catch {}
    } finally {
      setIsLoadingSuggestions(false);
    }
  }

  function submit() {
    if (!canBuild) return;
    recognitionRef.current?.stop();
    onSubmit(prompt.trim(), referenceImage);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setReferenceImage(base64);
    };
    reader.readAsDataURL(file);
  }

  function toggleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = LOCALE_BCP47[locale] || 'en-US';
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setPrompt(transcript.slice(0, MAX_CHARS));
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
    setIsListening(true);
  }

  function pickIdea(idea: Idea) {
    setPrompt(idea.prompt.slice(0, MAX_CHARS));
    textareaRef.current?.focus();
  }

  const iconButton =
    'flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-foreground';

  return (
    <div className="w-full">
      <h1 className="font-display text-[32px] font-bold leading-[1.1] text-foreground sm:text-[44px]">
        {t('create.hero.title')}
      </h1>
      <p className="mt-3 max-w-[60ch] text-muted">{t('create.hero.help')}</p>

      <form onSubmit={handleSubmit} className="mt-8">
        {/* The composer is the one big thing on this screen: input, attachments and Build live in one surface. */}
        <div className="rounded-2xl border border-border bg-card transition focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
          <label htmlFor="create-prompt" className="sr-only">
            {t('create.hero.title')}
          </label>
          <textarea
            id="create-prompt"
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('create.composer.placeholder')}
            maxLength={MAX_CHARS}
            rows={5}
            className="block min-h-[148px] w-full resize-none bg-transparent px-5 pt-5 pb-2 text-[17px] leading-relaxed text-foreground outline-none placeholder:text-subtle sm:min-h-[168px]"
            // the composer's own border and ring show focus; the global outline (unlayered, so it beats utilities) would box the text
            style={{ outline: 'none' }}
            disabled={isGenerating}
          />

          {referenceImage && (
            <div className="mx-5 mb-2 flex items-center gap-3 rounded-lg bg-surface p-2 pr-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                // browsers sniff the real image type, so a generic image subtype is fine for jpeg/webp/gif too
                src={`data:image/png;base64,${referenceImage}`}
                alt={t('create.composer.imageAttached')}
                className="h-12 w-12 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{t('create.composer.imageAttached')}</p>
                <p className="text-sm text-muted">{t('create.composer.imageHint')}</p>
              </div>
              <button
                type="button"
                onClick={() => setReferenceImage(undefined)}
                className={iconButton}
                aria-label={t('create.composer.removeImage')}
                title={t('create.composer.removeImage')}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-3 pb-3">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={iconButton}
                aria-label={t('create.composer.attach')}
                title={t('create.composer.attach')}
                disabled={isGenerating}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

              {hasVoiceSupport && (
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  className={isListening ? `${iconButton} bg-danger/15 text-danger hover:bg-danger/20 hover:text-danger` : iconButton}
                  aria-pressed={isListening}
                  aria-label={isListening ? t('create.composer.stopVoice') : t('create.composer.voice')}
                  title={isListening ? t('create.composer.stopVoice') : t('create.composer.voice')}
                  disabled={isGenerating}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
              )}

              {prompt.length > MAX_CHARS * 0.8 && (
                <span className="ml-2 text-sm text-muted">{t('create.composer.count', { count: prompt.length, max: MAX_CHARS })}</span>
              )}
            </div>

            <button
              type="submit"
              disabled={!canBuild}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:bg-surface disabled:text-subtle"
            >
              {t('create.composer.build')}
            </button>
          </div>
        </div>

        {!isGenerating && looksOffTopic(prompt) && (
          <p className="mt-3 text-sm text-warning">{t('create.composer.offTopic')}</p>
        )}
      </form>

      {!isGenerating && (
        <div className="mt-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-medium text-muted">{t('create.ideas.title')}</h2>
            <button
              type="button"
              onClick={handleSuggestNewIdeas}
              disabled={isLoadingSuggestions}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-accent-hover transition hover:bg-surface disabled:opacity-60"
            >
              {isLoadingSuggestions && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-hover border-t-transparent" aria-hidden />
              )}
              {isLoadingSuggestions ? t('create.ideas.loading') : t('create.ideas.more')}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={`${s.label}-${i}`}
                type="button"
                onClick={() => pickIdea(s)}
                title={s.prompt}
                className="min-h-10 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm text-foreground transition hover:border-accent/50"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
