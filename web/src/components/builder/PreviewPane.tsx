'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

type Device = 'desktop' | 'tablet' | 'mobile';

const DEVICES: { id: Device; labelKey: string; icon: ReactNode }[] = [
  {
    id: 'desktop',
    labelKey: 'create.preview.desktop',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm4 15h8m-4-4v4" />,
  },
  {
    id: 'tablet',
    labelKey: 'create.preview.tablet',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zm4 15h2" />,
  },
  {
    id: 'mobile',
    labelKey: 'create.preview.phone',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 3h6a2 2 0 012 2v14a2 2 0 01-2 2H9a2 2 0 01-2-2V5a2 2 0 012-2zm2 15h2" />,
  },
];

interface PreviewPaneProps {
  /** Shows a close button in the toolbar (the phone sheet and the closable desktop panel use it). */
  onClose?: () => void;
  /** Extra controls placed before the device switch (for example the versions menu). */
  actions?: ReactNode;
}

export function PreviewPane({ onClose, actions }: PreviewPaneProps = {}) {
  const t = useTranslations();
  const { previewHtml } = useProjectStore();
  const { previewDevice, setPreviewDevice } = useUIStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, [previewHtml]);

  const toolButton = 'flex h-10 w-10 items-center justify-center rounded-lg transition';

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5 sm:px-3">
        <div className="flex min-w-0 items-center gap-1">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`${toolButton} text-muted hover:bg-surface hover:text-foreground`}
              aria-label={t('create.preview.close')}
              title={t('create.preview.close')}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <span className="truncate pl-1 text-sm font-medium text-foreground">{t('create.preview.title')}</span>
        </div>
        <div className="flex items-center gap-1">
          {actions}
          <div className="hidden items-center gap-0.5 rounded-lg bg-surface p-0.5 sm:flex" role="group" aria-label={t('create.preview.device')}>
            {DEVICES.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setPreviewDevice(d.id)}
                aria-pressed={previewDevice === d.id}
                aria-label={t(d.labelKey)}
                title={t(d.labelKey)}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-md transition',
                  previewDevice === d.id ? 'bg-card text-foreground' : 'text-muted hover:text-foreground'
                )}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                  {d.icon}
                </svg>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className={`${toolButton} text-muted hover:bg-surface hover:text-foreground`}
            aria-label={t('create.preview.reload')}
            title={t('create.preview.reload')}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-background p-0 sm:p-4">
        {previewHtml ? (
          <div
            className={cn(
              // the app's own canvas: generated apps assume a white page unless they set a background
              'h-full max-w-full overflow-hidden bg-white',
              previewDevice === 'mobile'
                ? 'sm:max-h-[844px] sm:rounded-[28px] sm:border-[6px] sm:border-surface'
                : previewDevice === 'tablet'
                  ? 'sm:rounded-xl sm:border sm:border-border'
                  : 'sm:rounded-lg sm:border sm:border-border'
            )}
            style={{
              width: previewDevice === 'desktop' ? '100%' : previewDevice === 'tablet' ? '768px' : '390px',
            }}
          >
            <iframe
              key={refreshKey}
              ref={iframeRef}
              srcDoc={previewHtml}
              className="h-full w-full border-0"
              sandbox="allow-scripts"
              title={t('create.preview.title')}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-muted">
            <p>{t('create.preview.empty')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
