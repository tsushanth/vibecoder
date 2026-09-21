'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { api } from '@/lib/api';

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
        router.push('/dashboard');
      } else {
        router.push('/login');
      }
    });
  }, [router]);

  return (
    <div className="theme-paper flex min-h-screen items-center justify-center bg-[#FAF6F1] text-[#17140F]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[#5B4CFF] border-t-transparent" />
        <p className="text-[#17140F]/62">Signing you in...</p>
      </div>
    </div>
  );
}
