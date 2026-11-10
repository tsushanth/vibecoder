// Headers for calls to the deploy server's write endpoints (/deploy, /cleanup, DELETE /deploy/:subdomain).
// The deploy server rejects them without the shared INTERNAL_SECRET, so no one else can publish over or remove a site.
import { requireSecret } from './requireSecret.js';

export function deployServerHeaders(extra = {}, env = process.env) {
    return { ...extra, 'x-internal-secret': requireSecret('INTERNAL_SECRET', env) };
}
