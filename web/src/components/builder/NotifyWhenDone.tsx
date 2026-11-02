'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { flaggedTitle, notificationState, shouldFireNotification, unflaggedTitle, type NotificationState } from '@/lib/buildNotify';

type Stage = 'building' | 'ready' | 'failed';

/**
 * "Notify me when it's done" for a running build: asks the browser for notification permission when asked, and when the
 * build finishes while the tab is in the background it shows a system notification (if allowed) and puts a hint in the tab
 * title until the person comes back. Browser only: nothing is sent to a server and no service worker is involved.
 */
export function NotifyWhenDone({ stage }: { stage: Stage }) {
  const t = useTranslations('create.notify');
  const [permission, setPermission] = useState<NotificationState>('unsupported');
  const [armed, setArmed] = useState(false);
  const previous = useRef<Stage>(stage);
  const originalTitle = useRef<string | null>(null);
  const flag = useRef<string>('');

  // The Notification API only exists in the browser, so its state is read after mount.
  useEffect(() => {
    const id = setTimeout(() => setPermission(notificationState(window)), 0);
    return () => clearTimeout(id);
  }, []);

  // Take the hint off the tab title as soon as the person is back.
  useEffect(() => {
    function restore() {
      if (document.hidden || originalTitle.current === null) return;
      document.title = unflaggedTitle(document.title, flag.current);
      originalTitle.current = null;
    }
    document.addEventListener('visibilitychange', restore);
    window.addEventListener('focus', restore);
    return () => {
      document.removeEventListener('visibilitychange', restore);
      window.removeEventListener('focus', restore);
      if (originalTitle.current !== null) document.title = unflaggedTitle(document.title, flag.current);
    };
  }, []);

  useEffect(() => {
    const was = previous.current;
    previous.current = stage;
    if (was !== 'building' || stage === 'building') return;

    const ready = stage === 'ready';
    const hidden = document.hidden;
    if (hidden) {
      flag.current = ready ? t('tabReady') : t('tabFailed');
      originalTitle.current = document.title;
      document.title = flaggedTitle(document.title, flag.current);
    }
    if (shouldFireNotification({ armed, permission: notificationState(window), hidden })) {
      try {
        const n = new Notification(ready ? t('readyTitle') : t('failedTitle'), {
          body: ready ? t('readyBody') : t('failedBody'),
          tag: 'vibebuild-build',
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // Some browsers (for example Chrome on Android) only allow notifications from a service worker. Skip silently.
      }
    }
  }, [stage, armed, t]);

  async function arm() {
    try {
      const result = await Notification.requestPermission();
      setPermission(notificationState({ Notification: { permission: result } }));
      if (result === 'granted') setArmed(true);
    } catch {
      setPermission('unsupported');
    }
  }

  if (stage !== 'building') return null;
  if (permission === 'unsupported' || permission === 'denied') return null;

  if (armed) return <p className="mt-3 text-sm text-muted">{t('armed')}</p>;
  return (
    <button
      type="button"
      onClick={() => void arm()}
      className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground transition hover:bg-surface"
    >
      {t('ask')}
    </button>
  );
}
