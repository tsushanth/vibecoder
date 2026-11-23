'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

// Old sign-in return address, kept so links already sent still work: sign-in now returns straight to /connect (see lib/safeRedirect.ts).
export default function ConnectCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tgId = searchParams.get('tg_id');

  useEffect(() => {
    router.replace(tgId ? `/connect?tg_id=${encodeURIComponent(tgId)}` : '/connect');
  }, [router, tgId]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background text-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    </div>
  );
}
