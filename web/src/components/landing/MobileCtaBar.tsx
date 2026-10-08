'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/authStore';

/** Phones only: the main button stays on screen while the page scrolls, as on the Android landing screen. */
export function MobileCtaBar() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-5 pb-3 pt-3 backdrop-blur md:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
      {user ? (
        <Link href="/project/new" className="block rounded-lg bg-accent py-3.5 text-center font-semibold text-white">Open VibeBuild</Link>
      ) : (
        <>
          <Link href="/signup" className="block rounded-lg bg-accent py-3.5 text-center font-semibold text-white">Get started, it&apos;s free</Link>
          <Link href="/login" className="mt-1.5 block py-1.5 text-center text-sm text-muted">Already have an account? Sign in</Link>
        </>
      )}
    </div>
  );
}
