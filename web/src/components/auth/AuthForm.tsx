'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { api } from '@/lib/api';

interface AuthFormProps {
  mode: 'login' | 'signup';
}

const field = 'w-full rounded-lg border border-border bg-surface px-4 py-3 text-foreground placeholder:text-subtle transition focus:border-accent focus:outline-none';

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: displayName || email.split('@')[0] } },
        });
        if (signUpError) throw signUpError;

        if (data.user) {
          await api.post('/api/auth/register', {
            userId: data.user.id,
            email: data.user.email,
            displayName: displayName || email.split('@')[0],
          });
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
      // the welcome screen sends people who have already seen it straight on to Create
      router.push('/welcome');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not sign you in. Check your details and try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleAuth() {
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/callback` },
    });
    if (oauthError) setError(oauthError.message);
  }

  const login = mode === 'login';

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="font-display text-3xl font-bold">{login ? 'Welcome back' : 'Create your account'}</h1>
      <p className="mb-8 mt-2 text-muted">{login ? 'Sign in to keep building.' : 'Start building apps with AI.'}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {!login && (
          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm text-muted">Name</label>
            <input id="name" type="text" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" className={field} />
          </div>
        )}
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm text-muted">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={field} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm text-muted">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              autoComplete={login ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={login ? 'Your password' : 'At least 6 characters'}
              className={`${field} pr-16`}
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-3 my-auto h-8 rounded-md px-2 text-sm text-muted hover:text-foreground" aria-pressed={showPassword}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <button type="submit" disabled={isLoading} className="w-full rounded-lg bg-accent px-4 py-3.5 font-semibold text-white transition hover:bg-accent-hover disabled:opacity-60">
          {isLoading ? (login ? 'Signing in…' : 'Creating your account…') : login ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        {login ? (
          <>New to VibeBuild? <Link href="/signup" className="font-medium text-accent-hover hover:underline">Create an account</Link></>
        ) : (
          <>Already have an account? <Link href="/login" className="font-medium text-accent-hover hover:underline">Sign in</Link></>
        )}
      </p>

      <div className="my-6 flex items-center gap-4 text-sm text-subtle">
        <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
      </div>

      {/* a light button on the dark page, with Google's own mark, so it reads as the way in with Google */}
      <button onClick={handleGoogleAuth} className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3.5 font-medium text-[#1F1F1F] transition hover:bg-white/90">
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continue with Google
      </button>

      <p className="mt-6 text-center text-xs text-subtle">
        By continuing you agree to our <Link href="/terms" className="underline hover:text-muted">Terms</Link> and <Link href="/privacy" className="underline hover:text-muted">Privacy Policy</Link>.
      </p>
    </div>
  );
}
