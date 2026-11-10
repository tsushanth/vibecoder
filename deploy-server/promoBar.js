// The fixed "Built with VibeBuild" bar added to every published page. Its links carry utm tags (source builtwith, medium
// app_banner, campaign = the app's subdomain) so signups that come from a shared app can be counted from users.utm_*.

const SUB_OK = /^[a-z0-9-]{1,63}$/;

export function promoUrl(subdomain) {
  const campaign = typeof subdomain === "string" && SUB_OK.test(subdomain) ? subdomain : "app";
  return `https://vibebuild.cc/?utm_source=builtwith&utm_medium=app_banner&utm_campaign=${campaign}`;
}

// Apple UGC guideline (1.2) requires a takedown affordance visible on every public page that hosts user-generated content.
// The "Report" link uses a mailto with the page's URL pre-filled so abuse@ can act within 24 hours.
export function promoScript(subdomain) {
  const url = promoUrl(subdomain);
  return `
<!-- VibeBuild Promo -->
<div id="vb-ad" style="position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#111;border-top:1px solid #333;padding:8px 12px;display:flex;align-items:center;gap:8px;font-family:system-ui;font-size:13px;color:#ccc">
  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Built with <a href="${url}" target="_blank" style="color:#7c3aed;text-decoration:none;font-weight:600">VibeBuild</a></span>
  <a href="#" onclick="event.preventDefault();var u=encodeURIComponent(location.href);location.href='mailto:abuse@kreativekoala.com?subject=Report%20VibeBuild%20page&body=URL%3A%20'+u+'%0A%0AReason%3A%20';" style="color:#888;text-decoration:underline;font-size:11px;white-space:nowrap">Report</a>
  <a href="${url}" target="_blank" style="background:#7c3aed;color:#fff;padding:4px 12px;border-radius:12px;text-decoration:none;font-size:12px;font-weight:600;white-space:nowrap">Try Free</a>
</div>
<style>#vb-ad a:hover{opacity:0.9}body{padding-bottom:44px!important}</style>
`;
}
