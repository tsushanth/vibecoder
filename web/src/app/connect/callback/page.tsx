'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/constants';

export default function TelegramConnectCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tgId = searchParams.get('tg_id');

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        // Register user if needed
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
        } catch {}

        // Redirect back to connect page with user authenticated
        router.replace(`/connect?tg_id=${tgId}`);
      } else {
        router.replace(`/login?redirect=/connect/callback?tg_id=${tgId}`);
      }
    });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Completing sign in...</p>
      </div>
    </div>
  );
}
