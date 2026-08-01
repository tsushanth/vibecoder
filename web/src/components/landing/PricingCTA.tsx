'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { useState } from 'react';

export function PricingCTA({ tier, label, highlighted }: {
  tier: string;
  label: string;
  highlighted: boolean;
}) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const className = `block w-full text-center px-4 py-2.5 rounded-xl font-semibold text-sm transition ${
    highlighted
      ? 'bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20'
      : 'border border-border hover:bg-surface text-foreground'
  }`;

  // Not logged in or free/team: link to signup
  if (!user || tier === 'free' || tier === 'team') {
    return (
      <Link href="/signup" className={className}>
        {label}
      </Link>
    );
  }

  // Logged in + Pro tier: initiate Stripe checkout
  async function handleCheckout() {
    setLoading(true);
    try {
      const data = await api.post<{ url: string }>('/api/subscriptions/create-checkout', {
        userId: user!.id,
        email: user!.email,
        tier: 'pro',
      });
      window.location.href = data.url;
    } catch {
      window.location.href = '/settings';
    }
  }

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className={`${className} disabled:opacity-50`}
    >
      {loading ? 'Loading...' : label}
    </button>
  );
}
