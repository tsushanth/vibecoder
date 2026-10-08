'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/authStore';

/** The plan buttons on the landing page. Signed-in visitors go to the Upgrade screen, everyone else to sign-up. */
export function PricingCTA({ tier, label, highlighted }: { tier: 'free' | 'pro'; label: string; highlighted: boolean }) {
  const user = useAuthStore((s) => s.user);
  const href = tier === 'pro' && user ? '/upgrade' : user ? '/project/new' : '/signup';
  const cls = highlighted
    ? 'bg-accent text-white hover:bg-accent-hover'
    : 'border border-border text-foreground hover:bg-surface';
  return (
    <Link href={href} className={`block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold transition ${cls}`}>
      {label}
    </Link>
  );
}
