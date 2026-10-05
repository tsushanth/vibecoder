// Files that belong to the platform, not to the published site. vibe.manifest.json declares which third-party APIs the app may call
// through the proxy and where the creator's key goes; vibe.schema.json declares the app's tables and who may read them. Both are
// registered with the platform at deploy time and must not be served.
const PRIVATE_FILE = /(^|\/)vibe\.(?:manifest|schema)\.json$/i;

export function stripPrivateFiles(files) {
  return files.filter((f) => !PRIVATE_FILE.test(String(f?.name ?? "").replace(/\\/g, "/")));
}
