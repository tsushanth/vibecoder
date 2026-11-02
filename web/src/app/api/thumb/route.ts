// GET /api/thumb?u=<thumbnail_url>: serves an app thumbnail from the (plain HTTP) screenshot service over our own HTTPS origin.
// Not an open proxy: `u` must pass buildUpstreamUrl (one fixed host and port, one path, preview subdomains only), the
// upstream URL is rebuilt from validated parts, redirects are refused, and only a small image response is passed on.
import { buildUpstreamUrl } from '@/lib/thumbProxy';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function plain(status: number, message: string, cache = 'no-store') {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': cache } });
}

export async function GET(request: Request) {
  const upstream = buildUpstreamUrl(new URL(request.url).searchParams.get('u'));
  if (!upstream) return plain(400, 'Bad thumbnail URL');

  let res: Response;
  try {
    res = await fetch(upstream, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    // Short cache so a screenshot-service blip is not pinned to the CDN, but a dead one is not hammered either.
    return plain(502, 'Thumbnail unavailable', 'public, max-age=60');
  }
  if (!res.ok) return plain(502, 'Thumbnail unavailable', 'public, max-age=60');

  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(type)) return plain(502, 'Thumbnail unavailable', 'public, max-age=60');
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return plain(502, 'Thumbnail too large', 'public, max-age=60');

  const body = await res.arrayBuffer().catch(() => null);
  if (!body || body.byteLength === 0 || body.byteLength > MAX_BYTES) return plain(502, 'Thumbnail unavailable', 'public, max-age=60');

  return new Response(body, {
    status: 200,
    headers: {
      // Never echo the upstream content type: only the allow-listed image types above.
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
    },
  });
}
