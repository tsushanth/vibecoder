'use client';

import { useCallback, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';

export type CheckoutState = 'idle' | 'starting' | 'failed';

/**
 * Starts Stripe checkout for Pro: the same request the Account page always made (POST /api/subscriptions/create-checkout with the
 * user's id, email and tier, then a redirect to the session url). Any failure, including an answer without a url, becomes
 * 'failed' so the screen can say so and offer a retry; the raw server error is never shown.
 */
export function useCheckout() {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<CheckoutState>('idle');

  const start = useCallback(async () => {
    if (!user) {
      setState('failed');
      return;
    }
    setState('starting');
    try {
      const data = await api.post<{ url?: string }>('/api/subscriptions/create-checkout', {
        userId: user.id,
        email: user.email,
        tier: 'pro',
      });
      if (!data?.url) throw new Error('checkout answered without a url');
      // stay in 'starting' while the browser leaves for Stripe
      window.location.href = data.url;
    } catch (err) {
      console.warn('Checkout failed:', err);
      setState('failed');
    }
  }, [user]);

  return { state, start };
}
