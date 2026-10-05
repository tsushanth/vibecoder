// Moves credentials a creator pastes into chat (generate prompt, tweak, plan, save) into the proxy vault before the text is
// saved, logged or forwarded. Fail-safe by construction: the returned text is ALWAYS the redacted one, even when the proxy is
// unconfigured or down, and no secret value is ever logged, thrown or returned.
import { extractSecrets } from '../lib/vendor/capture.js';
import { moveSecretsToVault } from '../lib/vendor/vault-capture.js';

/** Pure redaction, for places that must never see a value (logs, validation, third-party calls). No storage. */
export const redactForLog = (text) => extractSecrets(text).text;

/**
 * Returns { text, stored: [names], failed: [names] }. Never throws.
 * The project is registered with the proxy (ensureApp) before anything is stored; if that, or listing the existing names,
 * fails, nothing is stored and every found name is reported as failed.
 */
export async function captureChatSecrets({ text, appId, proxyAdmin, log = console.warn } = {}) {
    if (typeof text !== 'string') return { text: '', stored: [], failed: [] };
    let result;
    try {
        result = await moveSecretsToVault({
            text,
            appId,
            listNames: async (id) => {
                if (!proxyAdmin?.configured) throw new Error('proxy not configured');
                await proxyAdmin.ensureApp(id);
                return (await proxyAdmin.listSecrets(id)).map((s) => s.name);
            },
            setSecret: (id, name, value) => proxyAdmin.setSecret(id, name, value),
        });
    } catch {
        // moveSecretsToVault does not throw; this is a last line of defence that still never returns the raw text
        const { text: redacted, found } = extractSecrets(text);
        result = { text: redacted, stored: [], failed: found.map((f) => f.name) };
    }
    if (result.stored.length || result.failed.length) {
        log(`[secrets] chat capture project=${appId} stored=[${result.stored.join(',')}] failed=[${result.failed.join(',')}]`);
    }
    return result;
}
