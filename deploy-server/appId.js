// On a custom domain the SDK cannot read the app id from the hostname, so the page is served with it preset.
// The subdomain is validated to the same shape the backend enforces, so nothing unsafe can reach the inline script.
const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

export function injectAppId(html, subdomain) {
  if (typeof html !== "string" || typeof subdomain !== "string" || !SUBDOMAIN.test(subdomain)) return html;
  const tag = `<script>window.VIBE_APP_ID=${JSON.stringify(subdomain)};</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  return tag + html;
}
