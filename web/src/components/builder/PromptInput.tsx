'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import type { SuggestionsResponse } from '@/types/api';

const SAMPLE_PROMPTS = [
  { icon: '🎨', label: 'Portfolio Site', prompt: 'Build a personal portfolio website with a dark theme, animated hero section, project gallery with hover effects, skills section, and a working contact form' },
  { icon: '📋', label: 'Task Manager', prompt: 'Build a Kanban-style task manager with drag and drop columns (To Do, In Progress, Done), ability to add/edit/delete tasks, priority labels, and local storage persistence' },
  { icon: '🛒', label: 'E-Commerce Store', prompt: 'Build a modern e-commerce product page with image gallery, size selector, add to cart button, customer reviews section, and a responsive mobile layout' },
  { icon: '📊', label: 'Dashboard', prompt: 'Build an analytics dashboard with sidebar navigation, chart cards showing revenue/users/orders metrics, a data table with sorting, and a dark professional theme' },
  { icon: '🍕', label: 'Restaurant Menu', prompt: 'Build a restaurant website with a hero image, interactive menu with categories and filtering, reservation form, photo gallery, and Google Maps embed placeholder' },
  { icon: '🎮', label: 'Quiz Game', prompt: 'Build an interactive quiz game with multiple choice questions, score tracking, timer, progress bar, results screen with share button, and colorful animations' },
];

interface PromptInputProps {
  onSubmit: (prompt: string, referenceImage?: string) => void;
  isGenerating: boolean;
}

export function PromptInput({ onSubmit, isGenerating }: PromptInputProps) {
  const [prompt, setPrompt] = useState('');
  const [apiSuggestions, setApiSuggestions] = useState<{ label: string; prompt: string }[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [referenceImage, setReferenceImage] = useState<string | undefined>();
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    api
      .get<SuggestionsResponse>('/api/projects/suggestions?count=6')
      .then((data) => setApiSuggestions(data.suggestions))
      .catch(() => {});
  }, []);

  const suggestions = apiSuggestions.length > 0
    ? apiSuggestions.map((s, i) => ({ icon: SAMPLE_PROMPTS[i]?.icon || '💡', ...s }))
    : SAMPLE_PROMPTS;

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
    recognition.lang = 'en-US';
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
        <h1 className="text-3xl font-bold mb-3">What do you want to build?</h1>
        <p className="text-muted">
          Describe your app and our AI will build it in minutes
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Build a personal portfolio with a dark theme, project gallery, and contact form..."
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
                title={isListening ? 'Stop recording' : 'Voice input'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
            )}

            {/* Image attachment */}
            <label className="cursor-pointer p-1.5 hover:bg-surface-hover rounded-lg transition text-muted" title="Attach reference image">
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

        {imagePreview && (
          <div className="flex items-center gap-3 px-3 py-2 bg-surface border border-border rounded-lg">
            <img src={imagePreview} alt="Reference" className="w-12 h-12 rounded object-cover" />
            <div className="flex-1">
              <span className="text-xs text-foreground font-medium">Reference image attached</span>
              <p className="text-xs text-subtle">AI will use this as visual guidance</p>
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
              Building...
            </>
          ) : (
            'Start Building'
          )}
        </button>
      </form>

      {/* Sample prompts */}
      {!isGenerating && (
        <div className="mt-8">
          <p className="text-xs text-subtle mb-3 text-center">Try one of these ideas</p>
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
        </div>
      )}
    </div>
  );
}
