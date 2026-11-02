'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase';
import { resetLinkProblem, validateNewPassword } from '@/lib/passwordReset';

const field = 'w-full rounded-lg border border-border bg-surface px-4 py-3 text-foreground placeholder:text-subtle transition focus:border-accent focus:outline-none';

type Phase = 'checking' | 'ready' | 'invalid' | 'done';

/**
 * The page the reset email links to. Supabase turns the link into a short recovery session (the client does that on load);
 * with that session, updateUser({ password }) sets the new password.
 */
export function ResetPasswordForm() {
  const t = useTranslations('auth.reset');
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!cancelled && session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) setPhase((p) => (p === 'done' ? p : 'ready'));
    });

    // getSession waits for the client to finish reading the link, so a missing session here means the link did not work
    // (expired, already used, or opened in a different browser than the one that asked for it).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (resetLinkProblem(window.location.search, window.location.hash)) setPhase('invalid');
      else setPhase((p) => (p === 'done' ? p : session ? 'ready' : 'invalid'));
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setError(t(problem));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setSaving(false);
    }
  }

  if (phase === 'checking') {
    return (
      <div className="mx-auto w-full max-w-sm text-center" role="status">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-muted">{t('checking')}</p>
      </div>
    );
  }

  if (phase === 'invalid') {
    return (
      <div className="mx-auto w-full max-w-sm">
        <h1 className="font-display text-3xl font-bold">{t('invalidTitle')}</h1>
        <p className="mb-6 mt-2 text-muted">{t('invalidHelp')}</p>
        <Link href="/login" className="inline-block w-full rounded-lg bg-accent px-4 py-3.5 text-center font-semibold text-white transition hover:bg-accent-hover">
          {t('backToSignIn')}
        </Link>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="mx-auto w-full max-w-sm">
        <h1 className="font-display text-3xl font-bold">{t('doneTitle')}</h1>
        <p className="mb-6 mt-2 text-muted" role="status">{t('doneHelp')}</p>
        <Link href="/welcome" className="inline-block w-full rounded-lg bg-accent px-4 py-3.5 text-center font-semibold text-white transition hover:bg-accent-hover">
          {t('continue')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="font-display text-3xl font-bold">{t('title')}</h1>
      <p className="mb-8 mt-2 text-muted">{t('help')}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-password" className="mb-1.5 block text-sm text-muted">{t('newPassword')}</label>
          <input id="new-password" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('placeholder')} className={field} />
        </div>
        <div>
          <label htmlFor="confirm-password" className="mb-1.5 block text-sm text-muted">{t('confirmPassword')}</label>
          <input id="confirm-password" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <button type="submit" disabled={saving} className="w-full rounded-lg bg-accent px-4 py-3.5 font-semibold text-white transition hover:bg-accent-hover disabled:opacity-60">
          {saving ? t('saving') : t('save')}
        </button>
      </form>
    </div>
  );
}
