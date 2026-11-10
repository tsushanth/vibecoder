import type { Metadata } from 'next';
import { PublicBrowse } from '@/components/project/PublicBrowse';
import { API_URL } from '@/lib/constants';
import { appUrl, itemListJsonLd, jsonLdString, pickItems, type BrowseItem } from '@/lib/browseSeo';

export const metadata: Metadata = {
  title: 'Apps people built - VibeBuild',
  description: 'Browse apps that people described in plain words and VibeBuild built. Open one to try it, or remix it into your own.',
  alternates: { canonical: 'https://vibebuild.cc/browse' },
  openGraph: {
    title: 'Apps people built - VibeBuild',
    description: 'Browse apps that people described in plain words and VibeBuild built.',
    url: 'https://vibebuild.cc/browse',
    siteName: 'VibeBuild',
    type: 'website',
  },
};

// Re-fetched at most once an hour; a failed or slow API simply leaves the crawler list out.
export const revalidate = 3600;

async function firstApps(): Promise<BrowseItem[]> {
  try {
    const res = await fetch(`${API_URL}/api/projects/browse?limit=12&sort=popular`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { projects?: unknown };
    return pickItems(body.projects);
  } catch {
    return [];
  }
}

// Explore for signed-out visitors. The grid is rendered in the browser; the first apps are also in the HTML for crawlers.
export default async function PublicBrowsePage() {
  const items = await firstApps();
  const ld = itemListJsonLd(items);
  const crawlerList =
    items.length > 0 ? (
      <>
        {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />}
        <noscript>
          <ul className="mt-6 space-y-2">
            {items.map((it) => {
              const url = appUrl(it);
              return (
                <li key={it.id}>
                  {url ? <a href={url} className="font-medium text-accent-hover">{it.title}</a> : <span className="font-medium">{it.title}</span>}
                  {it.description ? <span className="text-muted"> - {it.description}</span> : null}
                </li>
              );
            })}
          </ul>
        </noscript>
      </>
    ) : null;

  return <PublicBrowse crawlerList={crawlerList} />;
}
