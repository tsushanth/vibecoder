'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { api } from '@/lib/api';
import { safeRedirect } from '@/lib/safeRedirect';

export default function CallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          await api.post('/api/auth/register', {
            userId: session.user.id,
            email: session.user.email,
            displayName:
              session.user.user_metadata?.full_name ||
              session.user.email?.split('@')[0] ||
              'Anonymous',
            avatarUrl: session.user.user_metadata?.avatar_url,
          });
        } catch {
          // User may already exist
        }
        router.push(safeRedirect(new URLSearchParams(window.location.search).get('redirect')) ?? '/welcome');
      } else {
        router.push('/login');
      }
    });
  }, [router]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="text-muted">Signing you in…</p>
      </div>
    </div>
  );
}
