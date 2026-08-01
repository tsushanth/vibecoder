'use client';

import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

const DEVICE_WIDTHS = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

export function PreviewPane() {
  const { previewHtml } = useProjectStore();
  const { previewDevice, setPreviewDevice } = useUIStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, [previewHtml]);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted">Preview</span>
        <div className="flex items-center gap-1">
          {(Object.keys(DEVICE_WIDTHS) as Array<keyof typeof DEVICE_WIDTHS>).map(
            (device) => (
              <button
                key={device}
                onClick={() => setPreviewDevice(device)}
                className={cn(
                  'px-2 py-1 rounded text-xs transition',
                  previewDevice === device
                    ? 'bg-accent/20 text-accent'
                    : 'text-subtle hover:text-foreground'
                )}
              >
                {device === 'desktop' ? '🖥' : device === 'tablet' ? '📱' : '📲'}
              </button>
            )
          )}
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="ml-2 p-1 text-subtle hover:text-foreground rounded transition"
            title="Refresh preview"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* iframe */}
      <div className="flex-1 flex items-start justify-center overflow-auto bg-[#1a1a1a] p-4">
        {previewHtml ? (
          <div
            className="bg-white rounded-lg overflow-hidden shadow-2xl transition-all duration-300"
            style={{
              width: DEVICE_WIDTHS[previewDevice],
              maxWidth: '100%',
              height: previewDevice === 'desktop' ? '100%' : '80vh',
            }}
          >
            <iframe
              key={refreshKey}
              ref={iframeRef}
              srcDoc={previewHtml}
              className="w-full h-full border-0"
              sandbox="allow-scripts"
              title="App Preview"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted">
            <div className="text-center">
              <div className="text-4xl mb-3 opacity-30">👁</div>
              <p className="text-sm">Preview will appear here</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
