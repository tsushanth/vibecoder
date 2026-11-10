// What the public Explore page tells crawlers and link previews before any script runs: a title and description (page
// metadata), schema.org ItemList JSON-LD, and a plain list of the first apps inside <noscript>. The interactive grid is
// client-rendered, so without this a crawler sees an empty page.

export interface BrowseItem {
  id: string;
  title: string;
  description?: string | null;
  published_url?: string | null;
}

const MAX_ITEMS = 12;

function clean(text: string | null | undefined, max: number): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Only an https link to a VibeBuild-hosted app is used as the item link. */
export function appUrl(item: BrowseItem): string | null {
  const u = item.published_url;
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && /(^|\.)vibebuild\.cc$/i.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function pickItems(raw: unknown): BrowseItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BrowseItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.title !== 'string' || !o.title.trim()) continue;
    out.push({
      id: o.id,
      title: clean(o.title, 80),
      description: typeof o.description === 'string' ? clean(o.description, 160) : null,
      published_url: typeof o.published_url === 'string' ? o.published_url : null,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export function itemListJsonLd(items: BrowseItem[]): Record<string, unknown> | null {
  if (items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Apps people built with VibeBuild',
    itemListElement: items.map((it, i) => {
      const url = appUrl(it);
      return {
        '@type': 'ListItem',
        position: i + 1,
        name: it.title,
        ...(url ? { url } : {}),
      };
    }),
  };
}

/** JSON-LD is embedded in a <script> tag: `<` is escaped so a title can never close the tag. */
export function jsonLdString(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}
