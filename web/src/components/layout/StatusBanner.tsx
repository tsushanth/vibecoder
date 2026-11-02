'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { parseSystemStatus, STATUS_POLL_MS, type SystemStatus } from '@/lib/systemStatus';

/** The Android app's maintenance banner: shown when GET /api/status says builds are unavailable (for example, at capacity). */
export function StatusBanner() {
  const t = useTranslations('apps');
  const [status, setStatus] = useState<SystemStatus>({ down: false, message: null });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (document.hidden) return; // no point asking while nobody is looking
      try {
        const raw = await api.get<unknown>('/api/status');
        if (!cancelled) setStatus(parseSystemStatus(raw));
      } catch {
        // A failed check is not an outage report: keep whatever we last knew.
      }
    }

    void check();
    const id = setInterval(() => void check(), STATUS_POLL_MS);
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!status.down) return null;
  return (
    <div role="status" className="border-b border-warning/30 bg-warning/15 px-4 py-2.5 text-center text-sm text-warning">
      {status.message ?? t('statusBanner.default')}
    </div>
  );
}
