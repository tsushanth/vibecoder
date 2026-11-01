'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/authStore';

/** The one button of the "free for now" section. Signed-in visitors go to Create, everyone else to sign-up. */
export function FreeForNowCTA() {
  const user = useAuthStore((s) => s.user);
  return (
    <Link href={user ? '/project/new' : '/signup'} className="inline-block rounded-lg bg-accent px-7 py-3.5 text-base font-semibold text-white transition hover:bg-accent-hover">
      Start building
    </Link>
  );
}
