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

  // Literal colors, not the app's semantic bg-accent/border-border/etc.:
  // this only renders on the paper-themed marketing page (see the note in
  // globals.css on why those semantic classes can't be scoped here).
  const className = `block w-full text-center px-4 py-2.5 rounded-full font-semibold text-sm transition ${
    highlighted
      ? 'bg-[#5B4CFF] hover:bg-[#4638D6] text-white'
      : 'border border-[#17140F]/12 hover:bg-[#17140F]/[0.04] text-[#17140F]'
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
