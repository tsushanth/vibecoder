// A `redirect` query parameter is only followed when it is a path on this site: it must start with a single "/" and may not
// carry a scheme, a host, a backslash or control characters. Anything else is ignored (the caller falls back to its default).
const SAFE = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#[\]]*$/;

export function safeRedirect(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 300) return null;
  if (!SAFE.test(raw) || raw.includes('\\') || /^\/[^?#]*:\/\//.test(raw)) return null;
  return raw;
}
