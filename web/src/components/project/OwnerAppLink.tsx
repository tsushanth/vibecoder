'use client';

import type { ReactNode } from 'react';

/**
 * A link to the creator's own published app. It shows and copies the clean address, and opens the signed one, so the
 * creator's visit is not counted.
 */
export function OwnerAppLink({ url, openUrl, className, children }: { url: string; openUrl: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        if (openUrl === url) return;
        e.preventDefault();
        window.open(openUrl, '_blank', 'noopener');
      }}
    >
      {children}
    </a>
  );
}
