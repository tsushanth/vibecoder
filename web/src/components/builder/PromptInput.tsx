'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { api } from '@/lib/api';
import type { SuggestionsResponse } from '@/types/api';

const LOCALE_BCP47: Record<string, string> = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
  zh: 'zh-CN', ko: 'ko-KR', pt: 'pt-BR', it: 'it-IT', hi: 'hi-IN',
};

// Weighted toward patterns that show up repeatedly and independently in real
// production prompts (trading/signal tracking, local service booking, drawing tools),
// not just generic app-category guesses — see the data review that drove this change.
// "Trading Signal Tracker" is deliberately scoped to a logging/tracking dashboard, not
// a broker-connected autonomous bot — that's outside what a generated web app can do,
// and promising it would just produce another failed/misleading generation.
const SAMPLE_PROMPTS = [
  { icon: '🎨', label: 'Portfolio Site', prompt: 'Build a personal portfolio website with a dark theme, animated hero section, project gallery with hover effects, skills section, and a working contact form' },
  { icon: '📋', label: 'Task Manager', prompt: 'Build a Kanban-style task manager with drag and drop columns (To Do, In Progress, Done), ability to add/edit/delete tasks, priority labels, and local storage persistence' },
  { icon: '📈', label: 'Trading Signal Tracker', prompt: 'Build a trading signal tracker dashboard where I can log entry/exit prices for trades, see win-rate and P&L stats, filter by symbol, and view a running watchlist — a tracking tool, not a live-execution bot' },
  { icon: '📊', label: 'Dashboard', prompt: 'Build an analytics dashboard with sidebar navigation, chart cards showing revenue/users/orders metrics, a data table with sorting, and a dark professional theme' },
  { icon: '🧰', label: 'Service Booking App', prompt: 'Build a local service booking app for home services (plumbing, cleaning, gardening) with service category cards, a calendar-based time slot picker, and a customer request form' },
  { icon: '🖌️', label: 'Drawing Studio', prompt: 'Build a drawing app using HTML canvas with brush size and color picker, an eraser, multiple layers, and undo/redo support' },
];

interface PromptInputProps {
  onSubmit: (prompt: string, referenceImage?: string) => void;
  isGenerating: boolean;
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

/** Heuristic only — used to gently nudge, never to block submission. A meaningful
 * share of real prompts are general chat/image questions rather than app descriptions
 * (confirmed from production data), so this catches the common shapes of that without
 * being a hard gate. */
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

export function PromptInput({ onSubmit, isGenerating }: PromptInputProps) {
  const [prompt, setPrompt] = useState('');
  const [apiSuggestions, setApiSuggestions] = useState<{ label: string; prompt: string }[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [referenceImage, setReferenceImage] = useState<string | undefined>();
  const [isListening, setIsListening] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const t = useTranslations();
  const locale = useLocale();

  useEffect(() => {
    api
      .get<SuggestionsResponse>('/api/projects/suggestions?count=6')
      .then((data) => setApiSuggestions(data.suggestions))
      .catch(() => {});
  }, []);

  const suggestions = apiSuggestions.length > 0
    ? apiSuggestions.map((s, i) => ({ icon: SAMPLE_PROMPTS[i]?.icon || '💡', ...s }))
    : SAMPLE_PROMPTS;

  async function handleSuggestNewIdeas() {
    setIsLoadingSuggestions(true);
    try {
      const data = await api.post<{ suggestions: { label: string; prompt: string }[] }>(
        '/api/projects/suggest-ideas',
        {}
      );
      if (data.suggestions && data.suggestions.length > 0) {
        setApiSuggestions(data.suggestions);
      }
    } catch {
      // Fallback: reshuffle from existing pool
      try {
        const data = await api.get<SuggestionsResponse>('/api/projects/suggestions?count=6');
        setApiSuggestions(data.suggestions);
      } catch {}
    } finally {
      setIsLoadingSuggestions(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    onSubmit(prompt.trim(), referenceImage);
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setReferenceImage(base64);
      setImagePreview(reader.result as string);
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
      setPrompt(transcript);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
    setIsListening(true);
  }

  const hasVoiceSupport = typeof window !== 'undefined' &&
    (!!window.SpeechRecognition || !!window.webkitSpeechRecognition);

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-3">{t('create.title')}</h1>
        <p className="text-muted">
          {t('create.subtitle')}
        </p>
        <p className="text-xs text-subtle mt-2 max-w-lg mx-auto">
          {t('create.scopeHint')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('create.placeholder')}
            maxLength={2000}
            rows={4}
            className="w-full px-4 py-3 pr-28 bg-surface border border-border rounded-xl text-foreground resize-none focus:outline-none focus:border-accent transition"
            disabled={isGenerating}
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
            <span className="text-xs text-subtle">{prompt.length}/2000</span>

            {/* Voice input */}
            {hasVoiceSupport && (
              <button
                type="button"
                onClick={toggleVoiceInput}
                className={`p-1.5 rounded-lg transition ${
                  isListening
                    ? 'bg-danger/20 text-danger animate-pulse'
                    : 'hover:bg-surface-hover text-muted'
                }`}
                title={isListening ? t('create.stopRecording') : t('create.voiceInput')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
            )}

            {/* Image attachment */}
            <label className="cursor-pointer p-1.5 hover:bg-surface-hover rounded-lg transition text-muted" title={t('create.attachImage')}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
            </label>
          </div>
        </div>

        {!isGenerating && looksOffTopic(prompt) && (
          <p className="px-3 py-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg">
            {t('create.offTopicNudge')}
          </p>
        )}

        {imagePreview && (
          <div className="flex items-center gap-3 px-3 py-2 bg-surface border border-border rounded-lg">
            <img src={imagePreview} alt="Reference" className="w-12 h-12 rounded object-cover" />
            <div className="flex-1">
              <span className="text-xs text-foreground font-medium">{t('create.referenceImageAttached')}</span>
              <p className="text-xs text-subtle">{t('create.referenceImageHint')}</p>
            </div>
            <button
              type="button"
              onClick={() => { setImagePreview(null); setReferenceImage(undefined); }}
              className="p-1 text-subtle hover:text-foreground rounded transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={!prompt.trim() || isGenerating}
          className="w-full px-4 py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {t('create.building')}
            </>
          ) : (
            t('create.startBuilding')
          )}
        </button>
      </form>

      {/* Sample prompts */}
      {!isGenerating && (
        <div className="mt-8">
          <p className="text-xs text-subtle mb-3 text-center">{t('create.tryIdeas')}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => setPrompt(s.prompt)}
                className="flex items-center gap-2 px-3 py-2.5 bg-surface hover:bg-surface-hover border border-border rounded-xl text-left transition group"
              >
                <span className="text-lg">{s.icon}</span>
                <span className="text-xs text-muted group-hover:text-foreground truncate">{s.label}</span>
              </button>
            ))}
          </div>
          <div className="text-center mt-4">
            <button
              type="button"
              onClick={handleSuggestNewIdeas}
              disabled={isLoadingSuggestions}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-accent hover:text-accent-hover bg-accent/5 hover:bg-accent/10 border border-accent/20 rounded-xl transition disabled:opacity-50"
            >
              {isLoadingSuggestions ? (
                <>
                  <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  {t('create.generatingIdeas')}
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {t('create.suggestNewIdeas')}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
