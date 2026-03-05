'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';

async function loadSubscriptionStatus(userId: string) {
  try {
    const data = await api.get<{ tier: string; status: string; limits?: Record<string, unknown> }>(
      `/api/subscriptions/status?userId=${userId}`
    );
    useAuthStore.getState().setSubscription({
      tier: data.tier || 'free',
      status: data.status || 'active',
      limits: data.limits as { dailyGenerations: number | string; tweaksPerProject: number | string; canCreatePrivateProjects: boolean } | undefined,
    });
  } catch {
    useAuthStore.getState().setSubscription({ tier: 'free', status: 'active' });
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setSession, setLoading } = useAuthStore();

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);

      if (session?.user) {
        api
          .post('/api/auth/register', {
            userId: session.user.id,
            email: session.user.email,
            displayName:
              session.user.user_metadata?.full_name ||
              session.user.email?.split('@')[0] ||
              'Anonymous',
            avatarUrl: session.user.user_metadata?.avatar_url,
          })
          .catch(() => {});

        loadSubscriptionStatus(session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
      if (session?.user) {
        loadSubscriptionStatus(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession, setLoading]);

  return <>{children}</>;
}
