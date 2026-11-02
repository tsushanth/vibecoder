/**
 * Same-origin proxy for app thumbnails.
 *
 * The backend stores a thumbnail as `http://178.156.231.255:3465/screenshot?url=<preview>&width=390&height=844` when it
 * could not upload the image to storage. That host is plain HTTP, so an HTTPS page cannot show it (mixed content). The
 * /api/thumb route fetches it server-side instead. This module is the allow-list: it decides which URLs the route may
 * fetch, and it rebuilds the upstream URL from validated parts rather than forwarding the caller's string.
 */

/** The one host the route will fetch from. */
export const SCREENSHOT_ORIGIN = 'http://178.156.231.255:3465';
const SCREENSHOT_HOST = '178.156.231.255';
const SCREENSHOT_PORT = '3465';
const SCREENSHOT_PATH = '/screenshot';

/** The screenshot service renders whatever page it is told to, so that page is limited to our own preview subdomains. */
const PREVIEW_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.vibebuild\.cc$/;

const MAX_INPUT_LENGTH = 1000;
const DEFAULT_WIDTH = 390;
const DEFAULT_HEIGHT = 844;
const MAX_DIMENSION = 2000;

function dimension(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback;
  if (!/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_DIMENSION ? n : null;
}

/** Returns the canonical upstream URL when `raw` is an allowed screenshot URL, otherwise null. */
export function buildUpstreamUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_INPUT_LENGTH) return null;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' || u.hostname !== SCREENSHOT_HOST || u.port !== SCREENSHOT_PORT) return null;
  if (u.username || u.password || u.pathname !== SCREENSHOT_PATH) return null;

  const targets = u.searchParams.getAll('url');
  if (targets.length !== 1) return null;
  let target: URL;
  try {
    target = new URL(targets[0]);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:' || target.username || target.password || target.port) return null;
  if (!PREVIEW_HOST.test(target.hostname)) return null;

  const width = dimension(u.searchParams.get('width'), DEFAULT_WIDTH);
  const height = dimension(u.searchParams.get('height'), DEFAULT_HEIGHT);
  if (width === null || height === null) return null;

  return `${SCREENSHOT_ORIGIN}${SCREENSHOT_PATH}?url=${encodeURIComponent(target.origin)}&width=${width}&height=${height}`;
}

/**
 * The src an <img> should use for a stored thumbnail_url: allow-listed screenshot URLs go through /api/thumb, https URLs
 * (storage) are used as they are, and anything else (unknown http, other schemes, empty) is dropped so the letter tile shows.
 */
export function thumbSrc(thumbnailUrl: string | null | undefined): string | null {
  if (!thumbnailUrl) return null;
  if (buildUpstreamUrl(thumbnailUrl)) return `/api/thumb?u=${encodeURIComponent(thumbnailUrl)}`;
  try {
    return new URL(thumbnailUrl).protocol === 'https:' ? thumbnailUrl : null;
  } catch {
    return null;
  }
}
