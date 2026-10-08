'use client';

import { useCallback, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/** 'none' = there is no web subscription to manage here (the plan was bought in the Android or iOS app). */
export type ManageState = 'idle' | 'opening' | 'none' | 'failed';

/**
 * Opens Stripe's customer portal (cancel, card, invoices) for the signed-in person: POST /api/subscriptions/portal with their access
 * token, then a redirect to the returned url. The server finds the Stripe customer from their own subscription, so nothing is sent.
 */
export function useManageBilling() {
  const [state, setState] = useState<ManageState>('idle');

  const open = useCallback(async () => {
    setState('opening');
    try {
      const data = await api.post<{ url?: string }>('/api/subscriptions/portal');
      if (!data?.url) throw new Error('portal answered without a url');
      // stay in 'opening' while the browser leaves for Stripe
      window.location.href = data.url;
    } catch (err) {
      console.warn('Opening billing failed:', err);
      setState(err instanceof ApiError && err.status === 404 ? 'none' : 'failed');
    }
  }, []);

  return { state, open };
}
