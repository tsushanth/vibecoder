// Gate for the deploy server's write endpoints (POST /deploy, DELETE /deploy/:subdomain, POST /cleanup).
// Only the VibeBuild API (and its scripts) may publish, replace or remove a site; they send the shared INTERNAL_SECRET.
import { timingSafeEqual, createHash } from "node:crypto";

const digest = (v) => createHash("sha256").update(String(v)).digest();

export function hasInternalSecret(req, secret) {
  const sent = req.headers?.["x-internal-secret"];
  if (typeof sent !== "string" || !sent || !secret) return false;
  return timingSafeEqual(digest(sent), digest(secret));
}

export function requireInternal(secret) {
  return (req, res, next) => {
    if (hasInternalSecret(req, secret)) return next();
    return res.status(401).json({ error: "Unauthorized" });
  };
}
