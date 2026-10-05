// Per-app signing keys. Derived from the platform master key with HKDF, using a purpose label and the app id, so a token
// signed for one app never verifies on another and the vault's key is never reused for signing.
import { hkdfSync } from 'node:crypto';

const APP_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function deriveAppKey(masterKeyHex, appId, purpose = 'vibe-enduser-jwt-v1') {
    if (typeof masterKeyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(masterKeyHex)) throw new Error('master key must be 64 hex characters');
    if (typeof appId !== 'string' || !APP_ID.test(appId)) throw new Error('invalid app id');
    return Buffer.from(hkdfSync('sha256', Buffer.from(masterKeyHex, 'hex'), Buffer.from(appId), Buffer.from(purpose), 32));
}
