'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase';
import { recoveryRedirectUrl } from '@/lib/passwordReset';

const field = 'w-full rounded-lg border border-border bg-surface px-4 py-3 text-foreground placeholder:text-subtle transition focus:border-accent focus:outline-none';

/** "Forgot password?": asks Supabase to email a reset link that comes back to /reset. */
export function ForgotPasswordPanel({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const t = useTranslations('auth.forgot');
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: recoveryRedirectUrl(window.location.origin),
      });
      if (resetError) throw resetError;
      // The same message whether or not an account exists for this address, so the form cannot be used to look people up.
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="font-display text-3xl font-bold">{t('title')}</h1>
      <p className="mb-8 mt-2 text-muted">{t('help')}</p>

      {sent ? (
        <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-foreground">
          <p>{t('sent')}</p>
          <p className="mt-2 text-muted">{t('googleHint')}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-email" className="mb-1.5 block text-sm text-muted">{t('email')}</label>
            <input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={field}
            />
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <button type="submit" disabled={sending} className="w-full rounded-lg bg-accent px-4 py-3.5 font-semibold text-white transition hover:bg-accent-hover disabled:opacity-60">
            {sending ? t('sending') : t('send')}
          </button>
          <p className="text-center text-sm text-muted">{t('googleHint')}</p>
        </form>
      )}

      <p className="mt-5 text-center text-sm">
        <button type="button" onClick={onBack} className="font-medium text-accent-hover hover:underline">
          {t('back')}
        </button>
      </p>
    </div>
  );
}
