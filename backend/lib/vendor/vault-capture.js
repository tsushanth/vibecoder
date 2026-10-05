// Moves credentials a creator pasted into chat into the vault. The caller (the VibeBuild backend) supplies listNames and
// setSecret, which call the proxy admin API. Fail-safe: the returned text is ALWAYS redacted, even when storing fails, and no
// value ever appears in the result or in an error.
import { extractSecrets } from './capture.js';

export async function moveSecretsToVault({ text, appId, listNames, setSecret }) {
    const probe = extractSecrets(text);
    if (!probe.found.length) return { text: probe.text, stored: [], failed: [] };
    let existing = [];
    let listFailed = false;
    try { existing = await listNames(appId); } catch { listFailed = true; }
    const { text: redacted, found } = extractSecrets(text, { existingNames: existing });
    if (listFailed) return { text: redacted, stored: [], failed: found.map((f) => f.name) };
    const stored = [];
    const failed = [];
    for (const f of found) {
        try { await setSecret(appId, f.name, f.value); stored.push(f.name); } catch { failed.push(f.name); }
    }
    return { text: redacted, stored, failed };
}
